// Presets de configuração de publicação por rede — guarda só as opções que o
// usuário reconfigura toda vez (formato do Instagram, visibilidade/categoria
// do YouTube, privacidade/interações do TikTok), não texto nem mídia. Ver
// public/app.html (aplicarPresetNaRede) e migrations/038.
const { Router } = require('express')
const pool = require('../db/pool')
const { PLATFORMS, parseId, serverError } = require('../utils/http')
const router = Router()

// GET /api/platform-presets — todos os presets do usuário, todas as redes
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, platform, name, config, criado_em FROM platform_presets WHERE user_id=$1 ORDER BY criado_em DESC`,
      [req.user.id]
    )
    res.json({ presets: rows })
  } catch (err) {
    serverError(res, err)
  }
})

// POST /api/platform-presets
router.post('/', async (req, res) => {
  try {
    const { platform, name, config } = req.body
    if (!PLATFORMS.includes(platform)) return res.status(400).json({ erro: 'Rede inválida' })
    if (!name?.trim()) return res.status(400).json({ erro: 'Informe um nome para o preset' })

    const { rows } = await pool.query(
      `INSERT INTO platform_presets (user_id, platform, name, config) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, platform, name.trim(), JSON.stringify(config || {})]
    )
    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    serverError(res, err)
  }
})

// DELETE /api/platform-presets/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    await pool.query('DELETE FROM platform_presets WHERE id=$1 AND user_id=$2', [id, req.user.id])
    res.status(204).send()
  } catch (err) {
    serverError(res, err)
  }
})

module.exports = router
