const { Router } = require('express')
const path = require('path')
const crypto = require('crypto')
const multer = require('multer')
const repo = require('../repositories/postsRepository')
const { publishPost } = require('../services/publisher')
const { probeVideo, isShortEligible } = require('../services/videoProbe')
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
router.post('/', upload.array('media', 10), async (req, res) => {
  try {
    const { text, group, scheduledAt, repeat = 'none', youtubeTitle } = req.body

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

    // scheduledAt vem do <input type="datetime-local"> sem timezone (ex:
    // "2026-06-15T10:20"), representando o horário de Brasília escolhido
    // pelo usuário. Fixamos -03:00 explicitamente para não depender do
    // timezone do processo Node.
    const scheduledAtBR = scheduledAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduledAt) && !/[Z+-]\d{2}:?\d{2}$/.test(scheduledAt)
      ? `${scheduledAt}:00-03:00`
      : scheduledAt

    if (!scheduledAtBR || Number.isNaN(new Date(scheduledAtBR).getTime()))
      return res.status(400).json({ erro: 'scheduledAt inválido' })

    // O driver pg grava colunas "timestamp without time zone" usando o
    // horário local do processo (sem aplicar o offset da string), então
    // convertemos explicitamente para UTC antes de enviar.
    const scheduledAtUTC = new Date(scheduledAtBR).toISOString().replace('Z', '')

    const files = req.files || []

    if (!text?.trim() && !files.length)
      return res.status(400).json({ erro: 'Informe o texto do post ou anexe uma imagem/vídeo' })

    // Legendas individuais de cada item do carrossel (array JSON de strings, na mesma ordem dos arquivos)
    let captions = []
    try {
      captions = JSON.parse(req.body.captions || '[]')
    } catch {
      return res.status(400).json({ erro: 'captions inválido' })
    }

    const items = files.map((f, i) => ({
      path: `/uploads/${f.filename}`,
      type: f.mimetype.startsWith('video/') ? 'video' : 'image',
      caption: captions[i] || ''
    }))

    const mediaPath = items[0]?.path || null
    const mediaType = items[0]?.type || null
    const mediaItems = items.length > 1 ? items : null

    // YouTube e TikTok exigem um vídeo para publicar; avisa o usuário se faltar.
    const temVideo = items.some(i => i.type === 'video')
    if (platforms.includes('youtube') && !temVideo)
      return res.status(400).json({ erro: 'Falta vídeo para publicar no YouTube. Anexe um vídeo ou desmarque o YouTube.' })

    // YouTube exige um título para o vídeo (texto do post é opcional/descrição).
    if (platforms.includes('youtube') && !youtubeTitle?.trim())
      return res.status(400).json({ erro: 'Informe o título do vídeo para publicar no YouTube.' })
    if (platforms.includes('tiktok') && !temVideo)
      return res.status(400).json({ erro: 'Falta vídeo para publicar no TikTok. Anexe um vídeo ou desmarque o TikTok.' })

    // Instagram exige imagem ou vídeo para publicar.
    if (platforms.includes('instagram') && !items.length)
      return res.status(400).json({ erro: 'Falta imagem ou vídeo para publicar no Instagram. Anexe uma mídia ou desmarque o Instagram.' })

    // Detecta se o vídeo do YouTube é elegível como Shorts: vertical (9:16) ou
    // quadrado (1:1) e com até 3 minutos. Vídeos horizontais (16:9) nunca são Shorts,
    // mesmo que curtos.
    let youtubeIsShort = null
    if (platforms.includes('youtube') && mediaType === 'video') {
      const absPath = path.join(__dirname, '../../public', mediaPath)
      try {
        const info = await probeVideo(absPath)
        youtubeIsShort = isShortEligible(info)
      } catch {
        youtubeIsShort = null
      }
    }

    const post = await repo.criarPost({ text: text?.trim() || null, platforms, group_name: group, scheduledAt: scheduledAtUTC, repeat, mediaPath, mediaType, mediaItems, youtubeTitle: youtubeTitle?.trim() || null, youtubeIsShort })
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
