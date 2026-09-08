const crypto = require('crypto')
const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, serverError } = require('../utils/http')
const router = Router()
router.get('/', async (req, res) => { try { const { rows } = await pool.query('SELECT id,name,prefix,last_used_at AS "lastUsedAt",criado_em AS "createdAt" FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL ORDER BY criado_em DESC', [req.user.id]); res.json({ apiKeys: rows }) } catch (err) { serverError(res, err) } })
router.post('/', async (req, res) => { try { if (typeof req.body?.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 120) return res.status(400).json({ erro: 'Informe um nome válido para a API key (até 120 caracteres).' }); const raw = `mk_${crypto.randomBytes(32).toString('hex')}`; const hash = crypto.createHash('sha256').update(raw).digest('hex'); const prefix = raw.slice(0, 12); const { rows } = await pool.query('INSERT INTO api_keys (user_id,name,prefix,key_hash) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.id, req.body.name.trim(), prefix, hash]); res.status(201).json({ id: rows[0].id, key: raw, prefix }) } catch (err) { serverError(res, err) } })
router.delete('/:id', async (req, res) => { try { const id = parseId(req.params.id); if (!id) return res.status(400).json({ erro: 'id inválido' }); await pool.query('UPDATE api_keys SET revoked_at=NOW() WHERE id=$1 AND user_id=$2', [id, req.user.id]); res.status(204).send() } catch (err) { serverError(res, err) } })
module.exports = router
