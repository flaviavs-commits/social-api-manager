const crypto = require('crypto')
const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, serverError } = require('../utils/http')
const { validateOutboundHttpsUrl } = require('../utils/outboundUrl')
const router = Router()
const events = new Set(['post_published', 'approval_updated', 'queue_created'])

router.get('/', async (req, res) => { try { const { rows } = await pool.query('SELECT id,name,url,events,active,last_status AS "lastStatus",last_error AS "lastError",criado_em AS "createdAt" FROM webhook_endpoints WHERE user_id=$1 ORDER BY criado_em DESC LIMIT 100', [req.user.id]); res.json({ webhooks: rows }) } catch (err) { serverError(res, err) } })
router.post('/', async (req, res) => {
  try {
    const { name, url, selectedEvents = ['post_published', 'approval_updated'] } = req.body || {}
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) return res.status(400).json({ erro: 'Informe um nome válido para o webhook.' })
    const safeUrl = await validateOutboundHttpsUrl(url)
    const webhookEvents = Array.isArray(selectedEvents) ? selectedEvents.filter(event => events.has(event)) : []
    if (!webhookEvents.length) return res.status(400).json({ erro: 'Selecione ao menos um evento.' })
    const secret = crypto.randomBytes(24).toString('hex')
    const { rows } = await pool.query('INSERT INTO webhook_endpoints (user_id,name,url,secret,events) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.user.id, name.trim(), safeUrl, secret, webhookEvents])
    res.status(201).json({ id: rows[0].id, secret })
  } catch (err) {
    if (/Destino|URL|host/.test(String(err.message || ''))) return res.status(400).json({ erro: err.message })
    serverError(res, err)
  }
})
router.patch('/:id', async (req, res) => { try { const id = parseId(req.params.id); if (!id) return res.status(400).json({ erro: 'id inválido' }); await pool.query('UPDATE webhook_endpoints SET active=$1 WHERE id=$2 AND user_id=$3', [Boolean(req.body?.active), id, req.user.id]); res.status(204).send() } catch (err) { serverError(res, err) } })
router.delete('/:id', async (req, res) => { try { const id = parseId(req.params.id); if (!id) return res.status(400).json({ erro: 'id inválido' }); await pool.query('DELETE FROM webhook_endpoints WHERE id=$1 AND user_id=$2', [id, req.user.id]); res.status(204).send() } catch (err) { serverError(res, err) } })
module.exports = router
