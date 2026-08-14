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
    `SELECT status, COUNT(*)::int AS count
       FROM posts
      WHERE user_id=$1 AND criado_em >= $2${platformFilter}
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
  const pdf = await gerarRelatorioPdf({
    name: schedule.name,
    periodDays,
    platform: schedule.platform || null,
    rows
  })
  await mailer.enviarRelatorioAgendado(recipients, schedule.name, periodDays, summary, {
    filename: `relatorio-${String(schedule.name || 'operacional').toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'operacional'}.pdf`,
    pdf
  })
  return { periodDays, recipientCount: recipients.length }
}

module.exports = { escapeHtml, normalizePeriodDays, buscarDadosRelatorio, gerarResumoRelatorio, enviarRelatorioAgendado }
