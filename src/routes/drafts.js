const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, serverError } = require('../utils/http')
const router = Router()

// GET /api/drafts
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, text, platforms, media_path, media_type, media_items,
              youtube_title, youtube_visibility, is_template, criado_em,
              text_by_platform, media_by_platform
       FROM drafts WHERE user_id=$1 ORDER BY criado_em DESC`,
      [req.user.id]
    )
    res.json({ drafts: rows })
  } catch (err) {
    serverError(res, err)
  }
})

// POST /api/drafts
router.post('/', async (req, res) => {
  try {
    const { title, text, platforms, mediaPath, mediaType, mediaItems, youtubeTitle, youtubeVisibility, isTemplate, textByPlatform, mediaByPlatform } = req.body
    const { rows } = await pool.query(
      `INSERT INTO drafts (user_id,title,text,platforms,media_path,media_type,media_items,youtube_title,youtube_visibility,is_template,text_by_platform,media_by_platform)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [req.user.id, title||null, text||null, platforms||[], mediaPath||null, mediaType||null,
       mediaItems ? JSON.stringify(mediaItems) : null, youtubeTitle||null, youtubeVisibility||'public', isTemplate||false,
       textByPlatform && Object.keys(textByPlatform).length ? JSON.stringify(textByPlatform) : null,
       mediaByPlatform && Object.keys(mediaByPlatform).length ? JSON.stringify(mediaByPlatform) : null]
    )
    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    serverError(res, err)
  }
})

// DELETE /api/drafts/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    await pool.query('DELETE FROM drafts WHERE id=$1 AND user_id=$2', [id, req.user.id])
    res.status(204).send()
  } catch (err) {
    serverError(res, err)
  }
})

module.exports = router
