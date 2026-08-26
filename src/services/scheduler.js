const cron = require('node-cron')
const { publishPost, finalizarInstagramPendentes, finalizarZernioPendentes, buscarContaToken } = require('../infra/social/publisher')
const { registrarLog, broadcastEvent } = require('../repositories/logsRepository')
const postsRepo = require('../infra/db/postsRepository')
const tokensRepo = require('../repositories/tokensRepository')
const pool = require('../db/pool')
const { enviarPush } = require('./pushService')
const { verificarSaudePlataformas } = require('./platformHealth')
const { comentarYoutube } = require('../infra/social/youtubePublisher')
const { mapWithConcurrency } = require('../utils/concurrency')
const { processarFilasRecorrentes, processarRelatoriosAgendados } = require('./prioritySchedulers')
const { dispatchWebhook } = require('./webhookService')
const { limparMidiasExpiradas } = require('./mediaCleanupService')
const { processarZernioWebhooksPendentes } = require('./zernioWebhookService')

const POST_CONCURRENCY = 4

// Retry automático de publicação com falha transitória (5xx/rate limit/rede)
// — ver src/infra/social/publisher.js (isErroTransitorio) e migrations/036.
// Backoff exponencial curto: 1min, 5min, 15min; depois disso desiste e marca
// error/partial definitivo, igual ao comportamento de antes de existir retry.
const RETRY_DELAYS_MIN = [1, 5, 15]

// Publica um post pendente e notifica o frontend.
// O post já chega com status 'processing' (reservado atomicamente por
// reservarPostsPendentes), então mesmo que a publicação demore mais que o
// intervalo do cron, o próximo ciclo não pode pegar o mesmo post de novo.
async function processarPost(post) {
  let status
  try {
    const results = await publishPost(post)
    // success: 'pending' (Instagram aguardando processamento) não é sucesso
    // nem falha ainda — só conta como "tudo certo" quando for true de fato.
    const pendente = results.some(r => r.success === 'pending')
    const sucesso = r => r.success === true
    const falhas = results.filter(r => r.success === false)

    // Só reagenda automaticamente quando NENHUMA rede publicou com sucesso e
    // TODAS as falhas são transitórias — se uma rede já publicou (partial) ou
    // se pelo menos uma falha é permanente (ex: token inválido), tentar de
    // novo não ajudaria e reagendar duplicaria a publicação nas redes que já
    // deram certo. Nesse caso vira error/partial definitivo, como antes.
    const todasFalharam = !pendente && falhas.length === results.length
    const todasTransitorias = falhas.length > 0 && falhas.every(r => r.transient)
    const podeTentarDeNovo = todasFalharam && todasTransitorias && post.retryCount < RETRY_DELAYS_MIN.length

    if (pendente) {
      // Post fica em 'processing' até finalizarInstagramPendentes() (via cron)
      // confirmar o resultado real — sem isso, marcaríamos como published/error
      // antes do Instagram sequer terminar de processar a mídia.
      status = 'processing'
      await postsRepo.atualizarStatusPost(post.id, status)
    } else if (podeTentarDeNovo) {
      const delayMin = RETRY_DELAYS_MIN[post.retryCount]
      const nextRetryAt = new Date(Date.now() + delayMin * 60000)
      await postsRepo.reagendarParaRetry(post.id, nextRetryAt)
      await registrarLog({
        type: 'warn',
        message: `Post #${post.id} falhou por erro transitório — nova tentativa em ${delayMin} min (tentativa ${post.retryCount + 1}/${RETRY_DELAYS_MIN.length})`,
        platform: null,
        user_id: post.userId
      })
      return // não fecha o post como error/published — ainda vai tentar de novo
    } else {
      status = results.every(sucesso) ? 'published'
        : results.some(sucesso) ? 'partial'
        : 'error'
      const failureDetails = falhas
        .map(result => `${result.platform || 'Rede social'}${result.account ? ` (${result.account})` : ''}: ${result.error || 'A rede não informou o motivo.'}`)
        .join(' | ') || null
      await postsRepo.atualizarStatusPost(post.id, status, status === 'published' ? null : failureDetails)
    }

    if (pendente) return // log/evento de conclusão só quando o Instagram confirmar

    const resumo = status === 'published' ? 'publicado com sucesso em todas as plataformas'
      : status === 'partial' ? 'publicado parcialmente (algumas plataformas falharam)'
      : 'falhou ao publicar em todas as plataformas'

    await registrarLog({
      type: status === 'error' ? 'err' : status === 'partial' ? 'warn' : 'ok',
      message: `Post #${post.id} ${resumo}`,
      platform: null,
      user_id: post.userId
    })

    broadcastEvent('post_published', {
      id: post.id,
      status,
      platforms: post.platforms,
      text: post.text,
      results
    }, post.userId)
    dispatchWebhook('post_published', { id: post.id, status, platforms: post.platforms, text: post.text }, post.userId).catch(() => {})

    // Envia push notification para o usuário
    try {
      const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions WHERE user_id=$1', [post.userId])
      for (const sub of subs) {
        await enviarPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          {
            title: status === 'published' ? '✅ Post publicado!' : status === 'partial' ? '⚠️ Post parcialmente publicado' : '❌ Falha ao publicar',
            body: post.text?.substring(0, 80) || 'Seu post foi processado',
            icon: '/icon-192.png'
          }
        )
      }
    } catch (pushErr) {
      console.error('Erro ao enviar push:', pushErr.message)
    }
  } catch (err) {
    // err.message às vezes vem vazio (ex: erro sem mensagem) — inclui o nome
    // do erro e a primeira linha do stack para não perder a causa real de
    // falhas que acontecem fora do try/catch por-plataforma do publisher.
    const detalhe = err.message || `${err.name || 'Erro'}: ${(err.stack || '').split('\n')[1]?.trim() || 'sem detalhes'}`
    await postsRepo.atualizarStatusPost(post.id, 'error', detalhe)
    await registrarLog({ type: 'err', message: `Post #${post.id} falhou ao publicar: ${detalhe}`, platform: null, user_id: post.userId })

    // Envia push de falha
    try {
      const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions WHERE user_id=$1', [post.userId])
      for (const sub of subs) {
        await enviarPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          {
            title: '❌ Falha ao publicar',
            body: post.text?.substring(0, 80) || 'Seu post não pôde ser publicado',
            icon: '/icon-192.png'
          }
        )
      }
    } catch (pushErr) {
      console.error('Erro ao enviar push de falha:', pushErr.message)
    }
  }
}

// Renova proativamente tokens expirados/expirando, para o usuário nunca precisar reconectar manualmente
async function renovarTokensProativamente() {
  try {
    const resultado = await tokensRepo.renovarTodos(null, true)
    if (resultado.total > 0) {
      await registrarLog({
        type: resultado.failed.length || resultado.requiresManual.length ? 'warn' : 'ok',
        message: `Renovação automática de tokens: ${resultado.renewed.length} renovados, ${resultado.requiresManual.length} exigem reconexão, ${resultado.failed.length} falharam (de ${resultado.total})`,
        platform: null
      })
    }
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro na renovação automática de tokens: ${err.message}`, platform: null })
  }
}

// Publishers de comentário por rede — só as que têm endpoint de comentário
// na API oficial (ver postsRepository.js, PLATAFORMAS_COM_COMENTARIO).
// Facebook/Instagram/TikTok/YouTube não entram mais aqui: migraram para o Zernio,
// que posta o firstComment nativamente na publicação (ver zernioPublisher.js).
const COMENTAR_POR_PLATAFORMA = {
  youtube: comentarYoutube
}

// A mídia só é removida depois que o prazo calculado no fechamento da
// publicação venceu. O serviço também verifica referências em rascunhos,
// filas, biblioteca e outros posts antes de apagar o Blob compartilhado.
async function executarLimpezaMidias() {
  try {
    const resultado = await limparMidiasExpiradas()
    if (resultado.deleted || resultado.deferred || resultado.errors) {
      await registrarLog({
        type: resultado.errors ? 'err' : 'info',
        message: `Limpeza de mídias: ${resultado.deleted} arquivo(s) excluído(s), ${resultado.deferred} adiado(s), ${resultado.errors} erro(s)`,
        platform: null
      })
    }
    return resultado
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro na limpeza automática de mídias: ${err.message}`, platform: null })
    return { candidates: 0, deleted: 0, deferred: 0, marked: 0, errors: 1 }
  }
}

// Publica o primeiro comentário automático nas publicações que já saíram e
// ainda estão com status 'pending' em post_first_comments — mesmo cron,
// tick de 1 min. Cada linha é independente (uma por post_publication), então
// uma falha isolada não afeta as demais.
async function processarPrimeirosComentarios() {
  let pendentes
  try {
    pendentes = await postsRepo.listarPrimeirosComentariosPendentes()
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro ao listar primeiros comentários pendentes: ${err.message}`, platform: null })
    return
  }

  await Promise.all(pendentes.map(async item => {
    const comentar = COMENTAR_POR_PLATAFORMA[item.platform]
    if (!comentar) {
      // Não deveria acontecer (a linha só é criada para plataformas
      // suportadas), mas falha explicitamente em vez de tentar para sempre.
      await postsRepo.atualizarStatusPrimeiroComentario(item.firstCommentId, 'failed', `Plataforma ${item.platform} não suporta comentário automático`)
      return
    }
    try {
      const isSuperAdmin = item.userRole === 'super_admin'
      const token = await buscarContaToken(item.platform, item.userId, isSuperAdmin, item.accountId)
      if (!token) throw new Error('Conta desconectada — não foi possível publicar o comentário')

      await comentar(token, item.externalPostId, item.firstComment)
      await postsRepo.atualizarStatusPrimeiroComentario(item.firstCommentId, 'done')
      await registrarLog({ type: 'ok', message: `Primeiro comentário publicado automaticamente [${item.platform}]`, platform: item.platform, user_id: item.userId })
    } catch (err) {
      await postsRepo.atualizarStatusPrimeiroComentario(item.firstCommentId, 'failed', err.message)
      await registrarLog({ type: 'err', message: `Falha ao publicar primeiro comentário [${item.platform}]: ${err.message}`, platform: item.platform, user_id: item.userId })
    }
  }))
}

async function processarPendentes() {
  // Drena callbacks persistidos da Zernio antes da reconciliação por polling.
  // Se a instância reiniciou depois de devolver 200 ao provedor, o resultado
  // ainda será processado sem depender de uma nova entrega externa.
  try {
    await processarZernioWebhooksPendentes()
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro ao processar webhooks da Zernio: ${err.message}`, platform: null })
  }
  try { await processarFilasRecorrentes() } catch (err) { await registrarLog({ type: 'err', message: `Erro ao processar fila recorrente: ${err.message}`, platform: null }) }
  try { await processarRelatoriosAgendados() } catch (err) { await registrarLog({ type: 'err', message: `Erro ao processar relatório agendado: ${err.message}`, platform: null }) }
  try {
    const recuperados = await postsRepo.recuperarPostsProcessingStale()
    if (recuperados.length) {
      await registrarLog({ type: 'err', message: `${recuperados.length} publicação(ões) presas em processamento foram encerradas para revisão`, platform: null })
    }
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro ao recuperar publicações presas: ${err.message}`, platform: null })
  }
  try {
    const pendentes = await postsRepo.reservarPostsPendentes()
    // Posts pendentes são independentes entre si (já reservados atomicamente como
    // 'processing'), então publicá-los em paralelo evita que um post lento (ex:
    // vídeo grande no Instagram) atrase a publicação dos demais que já venceram.
    await mapWithConcurrency(pendentes, processarPost, POST_CONCURRENCY)
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro ao programar post: ${err.message}`, platform: null })
  }

  // Verifica posts do Instagram que ficaram aguardando confirmação de
  // processamento em um tick anterior — mesmo cron, sem agendamento extra.
  try {
    await finalizarInstagramPendentes()
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro ao finalizar publicações pendentes do Instagram: ${err.message}`, platform: 'instagram' })
  }

  // Mesma ideia, para posts publicados via Zernio (Facebook/Instagram/
  // TikTok) cujo platformPostId ainda não veio na resposta imediata —
  // ver publisher.js/finalizarZernioPendentes.
  try {
    await finalizarZernioPendentes()
  } catch (err) {
    await registrarLog({ type: 'err', message: `Erro ao finalizar publicações pendentes do Zernio: ${err.message}`, platform: null })
  }

  // Primeiro comentário automático — mesmo cron, roda por último (depende
  // de post_publications já ter sido gravada, o que só acontece depois da
  // publicação real acima).
  await processarPrimeirosComentarios()
}

// Roda a cada minuto, publicando posts cujo horário chegou
function start() {
  cron.schedule('* * * * *', processarPendentes)
  // Processa imediatamente ao iniciar, para não esperar até 1 minuto por
  // posts que já estavam atrasados quando o servidor estava fora do ar
  // (ex: reinício/deploy).
  processarPendentes()

  // Renova tokens próximos do vencimento a cada 6 horas, e uma vez no início
  cron.schedule('0 */6 * * *', renovarTokensProativamente)
  renovarTokensProativamente()

  // Limpa mídias expiradas uma vez por hora. A execução inicial também cobre
  // arquivos que venceram enquanto a aplicação estava desligada.
  cron.schedule('17 * * * *', executarLimpezaMidias)
  executarLimpezaMidias()

  // Verifica a cada minuto se as redes sociais estão respondendo
  cron.schedule('* * * * *', verificarSaudePlataformas)
  verificarSaudePlataformas()

}

module.exports = { start, processarPost, processarPendentes, renovarTokensProativamente, executarLimpezaMidias, verificarSaudePlataformas }
