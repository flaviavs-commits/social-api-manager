const { Router } = require('express')
const pool = require('../db/pool')
const { serverError } = require('../utils/http')
const router = Router()

// Salva subscription do browser
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body
    const endpoint = subscription?.endpoint
    const p256dh = subscription?.keys?.p256dh
    const auth = subscription?.keys?.auth
    if (typeof endpoint !== 'string' || endpoint.length < 1 || endpoint.length > 2048 || !/^https:\/\//i.test(endpoint)) {
      return res.status(400).json({ erro: 'subscription inválida' })
    }
    if (typeof p256dh !== 'string' || p256dh.length < 16 || p256dh.length > 256 || typeof auth !== 'string' || auth.length < 8 || auth.length > 256) {
      return res.status(400).json({ erro: 'Chaves da subscription inválidas' })
    }
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh=$3, auth=$4, user_id=$1`,
      [req.user.id, endpoint, p256dh, auth]
    )
    res.json({ ok: true })
  } catch (err) {
    serverError(res, err)
  }
})

// Retorna chave pública VAPID para o cliente
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null })
})

module.exports = router
