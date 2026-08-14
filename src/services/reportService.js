const pool = require('../db/pool')
const mailer = require('./mailer')
const { gerarRelatorioPdf } = require('./reportPdf')

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizePeriodDays(value) {
  return Math.min(90, Math.max(1, Number(value) || 30))
}

function reportFilename(name) {
  const slug = String(name || 'operacional')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const filenameSlug = slug || 'operacional'
  return `${filenameSlug.startsWith('relatorio-') ? filenameSlug : `relatorio-${filenameSlug}`}.pdf`
}

async function gerarResumoRelatorio({ userId, periodDays, platform }) {
  const rows = await buscarDadosRelatorio({ userId, periodDays, platform })
  return rows.length
    ? rows.map(item => `<li>${escapeHtml(item.status)}: ${item.count}</li>`).join('')
    : '<li>Nenhuma publicação no período.</li>'
}

async function buscarDadosRelatorio({ userId, periodDays, platform }) {
  const days = normalizePeriodDays(periodDays)
  const params = [userId, new Date(Date.now() - days * 86400000)]
  const platformFilter = platform ? ' AND $3 = ANY(platforms)' : ''
  if (platform) params.push(platform)

  const { rows } = await pool.query(
    `WITH filtered AS (
       SELECT id, text, status, platforms, criado_em, published_at, scheduled_at
         FROM posts
        WHERE user_id=$1 AND criado_em >= $2${platformFilter}
     ), platform_counts AS (
       SELECT platform, COUNT(*)::int AS count
         FROM filtered, unnest(COALESCE(platforms, ARRAY[]::text[])) AS platform
        GROUP BY platform
     ), recent_posts AS (
       SELECT id, COALESCE(NULLIF(text, ''), 'Publicação sem texto') AS text,
              status, platforms,
              COALESCE(published_at, scheduled_at, criado_em) AS occurred_at
         FROM filtered
        ORDER BY occurred_at DESC NULLS LAST
     )
     SELECT status, COUNT(*)::int AS count,
            (SELECT COALESCE(json_agg(pc ORDER BY pc.platform), '[]'::json) FROM platform_counts pc) AS "platformRows",
            (SELECT COALESCE(json_agg(rp ORDER BY rp.occurred_at DESC NULLS LAST), '[]'::json) FROM recent_posts rp) AS "postRows"
       FROM filtered
      GROUP BY status
      ORDER BY status`,
    params
  )

  return rows
}

async function enviarRelatorioAgendado(schedule) {
  const periodDays = normalizePeriodDays(schedule.period_days ?? schedule.periodDays)
  const recipients = Array.isArray(schedule.recipients) && schedule.recipients.length
    ? schedule.recipients
    : [schedule.email].filter(Boolean)
  if (!recipients.length) throw new Error('Nenhum destinatário configurado para o relatório')

  const rows = await buscarDadosRelatorio({
    userId: schedule.user_id ?? schedule.userId,
    periodDays,
    platform: schedule.platform || null
  })
  const summary = rows.length
    ? rows.map(item => `<li>${escapeHtml(item.status)}: ${item.count}</li>`).join('')
    : '<li>Nenhuma publicação no período.</li>'
  const platformRows = rows[0]?.platformRows || []
  const postRows = rows[0]?.postRows || []
  const pdf = await gerarRelatorioPdf({
    name: schedule.name,
    periodDays,
    platform: schedule.platform || null,
    rows,
    platformRows,
    postRows
  })
  await mailer.enviarRelatorioAgendado(recipients, schedule.name, periodDays, summary, {
    filename: reportFilename(schedule.name),
    pdf
  })
  return { periodDays, recipientCount: recipients.length }
}

module.exports = { escapeHtml, normalizePeriodDays, reportFilename, buscarDadosRelatorio, gerarResumoRelatorio, enviarRelatorioAgendado }
