const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, PLATFORMS, serverError } = require('../utils/http')

const router = Router()
const frequencies = new Set(['weekly', 'monthly'])
function nextRun(frequency, from = new Date()) {
  const next = new Date(from)
  if (frequency === 'weekly') next.setDate(next.getDate() + 7)
  else next.setMonth(next.getMonth() + 1)
  return next
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id,name,period_days AS "periodDays",platform,recipients,frequency,branding,next_run_at AS "nextRunAt",active,last_sent_at AS "lastSentAt" FROM report_schedules WHERE user_id=$1 ORDER BY criado_em DESC', [req.user.id])
    res.json({ schedules: rows })
  } catch (err) { serverError(res, err) }
})

router.post('/', async (req, res) => {
  try {
    const { name, periodDays = 30, platform, recipients = [], frequency = 'monthly', branding = {} } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ erro: 'Informe um nome para o relatório.' })
    if (!frequencies.has(frequency)) return res.status(400).json({ erro: 'Frequência inválida.' })
    if (platform && !PLATFORMS.includes(platform)) return res.status(400).json({ erro: 'Rede inválida.' })
    const emails = Array.isArray(recipients) ? recipients.map(email => String(email).trim().toLowerCase()).filter(email => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)).slice(0, 20) : []
    if (!emails.length) return res.status(400).json({ erro: 'Informe ao menos um e-mail válido.' })
    const next = nextRun(frequency)
    const { rows } = await pool.query('INSERT INTO report_schedules (user_id,name,period_days,platform,recipients,frequency,branding,next_run_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [req.user.id, name.trim(), Math.min(90, Math.max(1, Number(periodDays) || 30)), platform || null, emails, frequency, JSON.stringify(branding || {}), next])
    res.status(201).json({ id: rows[0].id, nextRunAt: next })
  } catch (err) { serverError(res, err) }
})

router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const active = Boolean(req.body?.active)
    const { rowCount } = await pool.query('UPDATE report_schedules SET active=$1, atualizado_em=NOW() WHERE id=$2 AND user_id=$3', [active, id, req.user.id])
    if (!rowCount) return res.status(404).json({ erro: 'Relatório não encontrado.' })
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    await pool.query('DELETE FROM report_schedules WHERE id=$1 AND user_id=$2', [id, req.user.id])
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

module.exports = { router, nextRun }
