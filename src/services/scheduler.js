const cron = require('node-cron')
const { publishPost } = require('./publisher')
const { registrarLog, broadcastEvent } = require('../repositories/logsRepository')
const postsRepo = require('../repositories/postsRepository')
const tokensRepo = require('../repositories/tokensRepository')

// Publica um post pendente e notifica o frontend.
// O post já chega com status 'processing' (reservado atomicamente por
// reservarPostsPendentes), então mesmo que a publicação demore mais que o
// intervalo do cron, o próximo ciclo não pode pegar o mesmo post de novo.
async function processarPost(post) {
  let status
  try {
    const results = await publishPost(post)
    status = results.every(r => r.success) ? 'published'
      : results.some(r => r.success) ? 'partial'
      : 'error'

    await postsRepo.atualizarStatusPost(post.id, status)

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
  } catch (err) {
    await postsRepo.atualizarStatusPost(post.id, 'error')
    await registrarLog({ type: 'err', message: `Post #${post.id} falhou ao publicar: ${err.message}`, platform: null })
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
}

module.exports = { start }
