const { Router } = require('express')
const pool = require('../db/pool')
const router = Router()
router.get('/posts', async (req, res) => { const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)); const { rows } = await pool.query('SELECT id,text,platforms,status,scheduled_at AS "scheduledAt",published_at AS "publishedAt" FROM posts WHERE user_id=$1 ORDER BY criado_em DESC LIMIT $2', [req.user.id, limit]); res.json({ posts: rows }) })
router.get('/accounts', async (req, res) => { const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)); const offset = Math.max(0, Number(req.query.offset) || 0); const { rows } = await pool.query('SELECT id,name,handle,platform,ativo AS active FROM contas WHERE user_id=$1 ORDER BY criado_em DESC, id DESC LIMIT $2 OFFSET $3', [req.user.id, limit + 1, offset]); res.json({ accounts: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit }) })
router.get('/health', (_req, res) => res.json({ ok: true, version: 'v1' }))
module.exports = router
