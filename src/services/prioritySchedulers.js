const pool = require('../db/pool')
const postsRepo = require('../infra/db/postsRepository')
const contasRepo = require('../repositories/contasRepository')
const { registrarLog } = require('../repositories/logsRepository')
const { nextOccurrence } = require('../routes/contentQueues')
const { nextRun } = require('../routes/reportSchedules')
const { enviarRelatorioAgendado } = require('./reportService')

const REPORT_RETRY_DELAY_MS = 5 * 60 * 1000

async function processarFilasRecorrentes() {
  const { rows } = await pool.query('SELECT cq.*, COALESCE(u.timezone, \'America/Sao_Paulo\') AS user_timezone FROM content_queues cq JOIN users u ON u.id = cq.user_id WHERE cq.active=true AND cq.next_run_at IS NOT NULL AND cq.next_run_at <= NOW() ORDER BY cq.next_run_at ASC LIMIT 25')
  for (const queue of rows) {
    const claim = await pool.query('UPDATE content_queues SET next_run_at=$1, atualizado_em=NOW() WHERE id=$2 AND active=true AND next_run_at <= NOW()', [nextOccurrence(queue.recurrence, new Date(), queue.user_timezone), queue.id])
    if (!claim.rowCount) continue
    try {
      const content = queue.content || {}
      const platforms = Array.isArray(queue.platforms) ? queue.platforms : []
      if (platforms.includes('tiktok') && !['image/', 'video/'].some(prefix => String(content.mediaType || '').toLowerCase().startsWith(prefix))) {
        throw new Error('O TikTok precisa de uma imagem ou vídeo anexado.')
      }
      const accounts = await contasRepo.listarContasAtivasPorPlataformas(platforms, queue.user_id, false)
      const post = await postsRepo.criarPost({
        text: content.text || null,
        textByPlatform: content.textByPlatform || null,
        titleByPlatform: content.titleByPlatform || null,
        platforms,
        scheduledAt: new Date(Date.now() + 60 * 1000),
        repeat: 'none',
        mediaPath: content.mediaPath || null,
        // content_queues stores the upload MIME (e.g. video/mp4), while the
        // publication pipeline expects the normalized kind (video/image).
        mediaType: content.mediaPath
          ? (String(content.mediaType || '').toLowerCase().startsWith('video/') ? 'video' : 'image')
          : null,
        youtubeTitle: content.youtubeTitle || null,
        youtubeVisibility: content.youtubeVisibility || 'public',
        igFormat: content.igFormat || null,
        tiktokPrivacyLevel: content.tiktokPrivacyLevel || null,
        userId: queue.user_id,
        status: 'scheduled'
      })
      await postsRepo.definirContasDoPost(post.id, accounts)
      await registrarLog({ type: 'ok', message: `Fila "${queue.name}" criou o post #${post.id}`, platform: null, user_id: queue.user_id })
    } catch (err) {
      await registrarLog({ type: 'err', message: `Fila "${queue.name}" não conseguiu criar uma publicação: ${err.message}`, platform: null, user_id: queue.user_id })
    }
  }
}

async function processarRelatoriosAgendados() {
  const { rows } = await pool.query(`SELECT rs.*, u.email FROM report_schedules rs JOIN users u ON u.id=rs.user_id WHERE rs.active=true AND rs.next_run_at IS NOT NULL AND rs.next_run_at <= NOW() LIMIT 20`)
  if (!rows.length) return
  for (const schedule of rows) {
    const next = nextRun(schedule.frequency)
    const claim = await pool.query('UPDATE report_schedules SET next_run_at=$1, atualizado_em=NOW() WHERE id=$2 AND active=true AND next_run_at <= NOW()', [next, schedule.id])
    if (!claim.rowCount) continue
    try {
      await enviarRelatorioAgendado(schedule)
      await pool.query('UPDATE report_schedules SET last_sent_at=NOW(), atualizado_em=NOW() WHERE id=$1', [schedule.id])
      await registrarLog({ type: 'ok', message: `Relatório agendado "${schedule.name}" enviado`, platform: null, user_id: schedule.user_id })
    } catch (err) {
      const retryAt = new Date(Date.now() + REPORT_RETRY_DELAY_MS)
      await pool.query('UPDATE report_schedules SET next_run_at=$1, atualizado_em=NOW() WHERE id=$2 AND active=true', [retryAt, schedule.id])
      await registrarLog({ type: 'err', message: `Falha ao enviar relatório "${schedule.name}": ${err.message}`, platform: null, user_id: schedule.user_id })
    }
  }
}

module.exports = { processarFilasRecorrentes, processarRelatoriosAgendados }
