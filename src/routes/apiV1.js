const { Router } = require('express')
const pool = require('../db/pool')
const router = Router()
router.get('/posts', async (req, res) => { const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)); const { rows } = await pool.query('SELECT id,text,platforms,status,scheduled_at AS "scheduledAt",published_at AS "publishedAt" FROM posts WHERE user_id=$1 ORDER BY criado_em DESC LIMIT $2', [req.user.id, limit]); res.json({ posts: rows }) })
router.get('/accounts', async (req, res) => { const { rows } = await pool.query('SELECT id,name,handle,platform,ativo AS active FROM contas WHERE user_id=$1 ORDER BY criado_em DESC', [req.user.id]); res.json({ accounts: rows }) })
router.get('/health', (_req, res) => res.json({ ok: true, version: 'v1' }))
module.exports = router
