const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, PLATFORMS, serverError } = require('../utils/http')

const router = Router()
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))
const validDays = value => Array.isArray(value) && value.length > 0 && value.every(day => Number.isInteger(Number(day)) && Number(day) >= 0 && Number(day) <= 6)

function nextOccurrence(recurrence, from = new Date()) {
  const days = [...new Set((recurrence?.days || []).map(Number))].sort((a, b) => a - b)
  const [hour, minute] = String(recurrence?.time || '10:00').split(':').map(Number)
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(from)
    candidate.setDate(candidate.getDate() + offset)
    candidate.setHours(hour, minute, 0, 0)
    if (days.includes(candidate.getDay()) && candidate > from) return candidate
  }
  return new Date(from.getTime() + 24 * 60 * 60 * 1000)
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, platforms, content, recurrence, next_run_at AS "nextRunAt", active, criado_em AS "createdAt" FROM content_queues WHERE user_id=$1 ORDER BY criado_em DESC', [req.user.id])
    res.json({ queues: rows })
  } catch (err) { serverError(res, err) }
})

router.post('/', async (req, res) => {
  try {
    const { name, platforms, content, recurrence, active = true } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ erro: 'Informe um nome para a fila.' })
    if (!Array.isArray(platforms) || !platforms.length || platforms.some(platform => !PLATFORMS.includes(platform))) return res.status(400).json({ erro: 'Selecione redes válidas para a fila.' })
    if (!validDays(recurrence?.days) || !validTime(recurrence?.time)) return res.status(400).json({ erro: 'Defina dias e horário válidos para a recorrência.' })
    if (!content || typeof content !== 'object' || (!content.text && !content.textByPlatform)) return res.status(400).json({ erro: 'A fila precisa ter um texto ou texto por rede.' })
    const normalized = { days: [...new Set(recurrence.days.map(Number))].sort((a, b) => a - b), time: recurrence.time }
    const next = active ? nextOccurrence(normalized) : null
    const { rows } = await pool.query('INSERT INTO content_queues (user_id,name,platforms,content,recurrence,next_run_at,active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.user.id, name.trim(), platforms, JSON.stringify(content), JSON.stringify(normalized), next, Boolean(active)])
    res.status(201).json({ id: rows[0].id, nextRunAt: next })
  } catch (err) { serverError(res, err) }
})

router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const active = Boolean(req.body?.active)
    const next = active ? nextOccurrence(req.body?.recurrence || { days: [1, 3, 5], time: '10:00' }) : null
    const { rowCount } = await pool.query('UPDATE content_queues SET active=$1, next_run_at=$2, atualizado_em=NOW() WHERE id=$3 AND user_id=$4', [active, next, id, req.user.id])
    if (!rowCount) return res.status(404).json({ erro: 'Fila não encontrada.' })
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    await pool.query('DELETE FROM content_queues WHERE id=$1 AND user_id=$2', [id, req.user.id])
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

module.exports = { router, nextOccurrence }
