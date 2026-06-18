const cron = require('node-cron')
const pool = require('../db/pool')
const { publishPost } = require('./publisher')
const { registrarLog, broadcastEvent } = require('../repositories/logsRepository')
const postsRepo = require('../repositories/postsRepository')
const tokensRepo = require('../repositories/tokensRepository')

// Busca posts agendados cujo horário já chegou
async function buscarPostsPendentes() {
  const { rows } = await pool.query(`
    SELECT
      id, text, platforms, group_name AS "group",
      scheduled_at AS "scheduledAt", repeat, status, user_id AS "userId",
      media_path AS "mediaPath", media_type AS "mediaType", media_items AS "mediaItems",
      youtube_title AS "youtubeTitle", youtube_visibility AS "youtubeVisibility", youtube_is_short AS "youtubeIsShort"
    FROM posts
    WHERE status = 'scheduled' AND scheduled_at <= NOW()
  `)
  return rows
}

// Publica um post pendente e notifica o frontend
async function processarPost(post) {
  const results = await publishPost(post)

  const status = results.every(r => r.success) ? 'published'
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
    group: post.group,
    text: post.text,
    results
  }, post.userId)
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

// Roda a cada minuto, publicando posts cujo horário chegou
function start() {
  cron.schedule('* * * * *', async () => {
    try {
      const pendentes = await buscarPostsPendentes()
      for (const post of pendentes) {
        await processarPost(post)
      }
    } catch (err) {
      await registrarLog({ type: 'err', message: `Erro ao programar post: ${err.message}`, platform: null })
    }
  })

  // Renova tokens próximos do vencimento a cada 6 horas, e uma vez no início
  cron.schedule('0 */6 * * *', renovarTokensProativamente)
  renovarTokensProativamente()
}

module.exports = { start }
