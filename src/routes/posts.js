const { Router } = require('express')
const path = require('path')
const crypto = require('crypto')
const multer = require('multer')
const repo = require('../repositories/postsRepository')
const { publishPost } = require('../services/publisher')
const { PLATFORMS, REPEATS, parseId, serverError } = require('../utils/http')

const router = Router()

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../public/uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, crypto.randomUUID() + ext)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) return cb(null, true)
    cb(new Error('Arquivo precisa ser uma imagem ou vídeo'))
  }
})

// GET /api/posts
router.get('/', async (req, res) => {
  try {
    const { status } = req.query
    if (status !== undefined && !['scheduled', 'published', 'partial', 'error', 'cancelled'].includes(status)) {
      return res.status(400).json({ erro: 'status inválido' })
    }

    const posts = await repo.listarPosts({ status })
    res.json({ posts })
  } catch (e) {
    serverError(res, e)
  }
})

// POST /api/posts
router.post('/', upload.single('media'), async (req, res) => {
  try {
    const { text, group, scheduledAt, repeat = 'none' } = req.body

    let platforms
    try {
      platforms = JSON.parse(req.body.platforms || '[]')
    } catch {
      return res.status(400).json({ erro: 'platforms inválido' })
    }

    if (!Array.isArray(platforms) || !platforms.length || !platforms.every(p => PLATFORMS.includes(p)))
      return res.status(400).json({ erro: `platforms deve ser uma lista com valores de: ${PLATFORMS.join(', ')}` })

    if (!REPEATS.includes(repeat))
      return res.status(400).json({ erro: `repeat inválido. Use um de: ${REPEATS.join(', ')}` })

    if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))
      return res.status(400).json({ erro: 'scheduledAt inválido' })

    if (!text?.trim() && !req.file)
      return res.status(400).json({ erro: 'Informe o texto do post ou anexe uma imagem/vídeo' })

    const mediaPath = req.file ? `/uploads/${req.file.filename}` : null
    const mediaType = req.file ? (req.file.mimetype.startsWith('video/') ? 'video' : 'image') : null

    const post = await repo.criarPost({ text: text?.trim() || null, platforms, group_name: group, scheduledAt, repeat, mediaPath, mediaType })
    res.status(201).json(post)
  } catch (e) {
    serverError(res, e, 'Não foi possível agendar o post')
  }
})

// POST /api/posts/:id/publish - dispara a publicação imediatamente (teste manual)
router.post('/:id/publish', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const post = await repo.buscarPostPorId(id)
    if (!post) return res.status(404).json({ erro: 'Post não encontrado' })

    const results = await publishPost(post)
    const status = results.every(r => r.success) ? 'published'
      : results.some(r => r.success) ? 'partial'
      : 'error'
    await repo.atualizarStatusPost(post.id, status)

    res.json({ status, results })
  } catch (e) {
    serverError(res, e)
  }
})

// DELETE /api/posts/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const ok = await repo.deletarPost(id)
    if (!ok) return res.status(404).json({ erro: 'Post não encontrado ou já publicado' })
    res.status(204).send()
  } catch (e) {
    serverError(res, e)
  }
})

module.exports = router
