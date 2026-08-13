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
              text_by_platform, media_by_platform,
              ig_format, youtube_format, youtube_category_id, youtube_made_for_kids,
              tiktok_privacy_level, tiktok_disable_comment, tiktok_disable_duet, tiktok_disable_stitch,
              location_id, location_name, first_comment
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
    const {
      title, text, platforms, mediaPath, mediaType, mediaItems, youtubeTitle, youtubeVisibility, isTemplate,
      textByPlatform, mediaByPlatform, igFormat, youtubeFormat, youtubeCategoryId, youtubeMadeForKids,
      tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch,
      locationId, locationName, firstComment
    } = req.body
    const { rows } = await pool.query(
      `INSERT INTO drafts (
         user_id,title,text,platforms,media_path,media_type,media_items,youtube_title,youtube_visibility,is_template,
         text_by_platform,media_by_platform,ig_format,youtube_format,youtube_category_id,youtube_made_for_kids,
         tiktok_privacy_level,tiktok_disable_comment,tiktok_disable_duet,tiktok_disable_stitch,
         location_id,location_name,first_comment
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
      [req.user.id, title||null, text||null, platforms||[], mediaPath||null, mediaType||null,
       mediaItems ? JSON.stringify(mediaItems) : null, youtubeTitle||null, youtubeVisibility||'public', isTemplate||false,
       textByPlatform && Object.keys(textByPlatform).length ? JSON.stringify(textByPlatform) : null,
       mediaByPlatform && Object.keys(mediaByPlatform).length ? JSON.stringify(mediaByPlatform) : null,
       igFormat||null, youtubeFormat||null, youtubeCategoryId||null, youtubeMadeForKids||null,
       tiktokPrivacyLevel||null, tiktokDisableComment ?? null, tiktokDisableDuet ?? null, tiktokDisableStitch ?? null,
       locationId||null, locationName||null, firstComment||null]
    )
    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    serverError(res, err)
  }
})

// DELETE /api/drafts — esvazia o Baú de Ideias do usuário autenticado.
router.delete('/', async (req, res) => {
  try {
    await pool.query('DELETE FROM drafts WHERE user_id=$1', [req.user.id])
    res.status(204).send()
  } catch (err) {
    serverError(res, err)
  }
})

// PATCH /api/drafts/:id — autosave do editor sem criar vários rascunhos.
router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const { text, textByPlatform, platforms } = req.body || {}
    const { rowCount } = await pool.query(
      `UPDATE drafts SET text=$1, text_by_platform=$2, platforms=$3 WHERE id=$4 AND user_id=$5`,
      [typeof text === 'string' ? text : null, textByPlatform && Object.keys(textByPlatform).length ? JSON.stringify(textByPlatform) : null, Array.isArray(platforms) ? platforms : [], id, req.user.id]
    )
    if (!rowCount) return res.status(404).json({ erro: 'Rascunho não encontrado' })
    res.status(204).send()
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
