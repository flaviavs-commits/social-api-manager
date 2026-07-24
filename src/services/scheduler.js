const cron = require('node-cron')
const { publishPost, finalizarInstagramPendentes } = require('../infra/social/publisher')
const { registrarLog, broadcastEvent } = require('../repositories/logsRepository')
const postsRepo = require('../infra/db/postsRepository')
const tokensRepo = require('../repositories/tokensRepository')
const pool = require('../db/pool')
const { enviarPush } = require('./pushService')
const { verificarSaudePlataformas } = require('./platformHealth')

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
        platform: null
      })
      return // não fecha o post como error/published — ainda vai tentar de novo
    } else {
      status = results.every(sucesso) ? 'published'
        : results.some(sucesso) ? 'partial'
        : 'error'
      await postsRepo.atualizarStatusPost(post.id, status)
    }

    if (pendente) return // log/evento de conclusão só quando o Instagram confirmar

    const resumo = status === 'published' ? 'publicado com sucesso em todas as plataformas'
      : status === 'partial' ? 'publicado parcialmente (algumas plataformas falharam)'
      : 'falhou ao publicar em todas as plataformas'

    await registrarLog({
      type: status === 'error' ? 'err' : 'ok',
      message: `Post #${post.id} ${resumo}`,
      platform: null
    })

    broadcastEvent('post_published', {
      id: post.id,
      status,
      platforms: post.platforms,
      text: post.text,
      results
    }, post.userId)

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
    await postsRepo.atualizarStatusPost(post.id, 'error')
    // err.message às vezes vem vazio (ex: erro sem mensagem) — inclui o nome
    // do erro e a primeira linha do stack para não perder a causa real de
    // falhas que acontecem fora do try/catch por-plataforma do publisher.
    const detalhe = err.message || `${err.name || 'Erro'}: ${(err.stack || '').split('\n')[1]?.trim() || 'sem detalhes'}`
    await registrarLog({ type: 'err', message: `Post #${post.id} falhou ao publicar: ${detalhe}`, platform: null })

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

async function processarPendentes() {
  try {
    const pendentes = await postsRepo.reservarPostsPendentes()
    // Posts pendentes são independentes entre si (já reservados atomicamente como
    // 'processing'), então publicá-los em paralelo evita que um post lento (ex:
    // vídeo grande no Instagram) atrase a publicação dos demais que já venceram.
    await Promise.all(pendentes.map(processarPost))
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

  // Verifica a cada minuto se as redes sociais estão respondendo
  cron.schedule('* * * * *', verificarSaudePlataformas)
  verificarSaudePlataformas()
}

module.exports = { start, processarPendentes, renovarTokensProativamente, verificarSaudePlataformas }
