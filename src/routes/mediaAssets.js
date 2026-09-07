const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, serverError } = require('../utils/http')
const { isBlobUrl, ALLOWED_MEDIA_TYPES, MAX_UPLOAD_SIZE_BYTES } = require('../infra/storage/blobStorage')

const router = Router()

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0)
    const search = String(req.query.search || '').trim()
    const folder = String(req.query.folder || '').trim()
    const params = [req.user.id]
    const conditions = ['user_id=$1']
    if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE $${params.length}))`) }
    if (folder) { params.push(folder); conditions.push(`folder=$${params.length}`) }
    params.push(limit + 1, offset)
    const { rows } = await pool.query(`SELECT id, name, url, mime_type AS "mimeType", size_bytes AS "sizeBytes", folder, tags, criado_em AS "createdAt" FROM media_assets WHERE ${conditions.join(' AND ')} ORDER BY criado_em DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)
    res.json({ assets: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit })
  } catch (err) { serverError(res, err) }
})

router.post('/', async (req, res) => {
  try {
    const { name, url, mimeType, sizeBytes, folder, tags } = req.body || {}
    if (typeof name !== 'string' || !name.trim() || typeof url !== 'string' || !url.trim()) return res.status(400).json({ erro: 'Nome e URL são obrigatórios.' })
    if (!isBlobUrl(url.trim())) return res.status(400).json({ erro: 'A mídia precisa ser enviada pelo upload do aplicativo.' })
    const normalizedMimeType = String(mimeType || '').toLowerCase()
    if (!ALLOWED_MEDIA_TYPES.has(normalizedMimeType)) return res.status(400).json({ erro: 'Tipo de mídia não permitido.' })
    const normalizedSizeBytes = Number(sizeBytes)
    if (!Number.isFinite(normalizedSizeBytes) || normalizedSizeBytes < 0 || normalizedSizeBytes > MAX_UPLOAD_SIZE_BYTES)
      return res.status(400).json({ erro: 'Tamanho de mídia inválido.' })
    const normalizedTags = Array.isArray(tags) ? tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 20) : []
    const normalizedFolder = typeof folder === 'string' && folder.trim() ? folder.trim() : 'Geral'
    await pool.query('INSERT INTO media_folders (user_id, name) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM media_folders WHERE user_id=$1 AND LOWER(name)=LOWER($2))', [req.user.id, normalizedFolder])
    const { rows } = await pool.query(`INSERT INTO media_assets (user_id, name, url, mime_type, size_bytes, folder, tags) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [req.user.id, name.trim().slice(0, 255), url.trim(), normalizedMimeType, normalizedSizeBytes, normalizedFolder, normalizedTags])
    res.status(201).json({ id: rows[0].id })
  } catch (err) { serverError(res, err) }
})

router.patch('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const { name, folder, tags } = req.body || {}
    const normalizedTags = Array.isArray(tags) ? tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 20) : []
    const { rowCount } = await pool.query('UPDATE media_assets SET name=COALESCE($1,name), folder=COALESCE($2,folder), tags=$3 WHERE id=$4 AND user_id=$5', [name?.trim() || null, folder?.trim() || null, normalizedTags, id, req.user.id])
    if (!rowCount) return res.status(404).json({ erro: 'Mídia não encontrada.' })
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    await pool.query('DELETE FROM media_assets WHERE id=$1 AND user_id=$2', [id, req.user.id])
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

module.exports = router
