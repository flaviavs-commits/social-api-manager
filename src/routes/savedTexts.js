// Biblioteca de textos salvos, reutilizáveis entre posts — botão "textos
// salvos" no editor React.
const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, serverError } = require('../utils/http')
const router = Router()

// GET /api/saved-texts
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, body, criado_em FROM saved_texts WHERE user_id=$1 ORDER BY criado_em DESC`,
      [req.user.id]
    )
    res.json({ savedTexts: rows })
  } catch (err) {
    serverError(res, err)
  }
})

// POST /api/saved-texts
router.post('/', async (req, res) => {
  try {
    const { title, body } = req.body
    if (!body?.trim()) return res.status(400).json({ erro: 'Informe o texto a salvar' })

    const { rows } = await pool.query(
      `INSERT INTO saved_texts (user_id, title, body) VALUES ($1, $2, $3) RETURNING id`,
      [req.user.id, title?.trim() || null, body.trim()]
    )
    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    serverError(res, err)
  }
})

// DELETE /api/saved-texts/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    await pool.query('DELETE FROM saved_texts WHERE id=$1 AND user_id=$2', [id, req.user.id])
    res.status(204).send()
  } catch (err) {
    serverError(res, err)
  }
})

module.exports = router


