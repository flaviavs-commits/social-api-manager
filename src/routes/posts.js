const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const multer = require('multer')
const FileType = require('file-type')
const repo = require('../repositories/postsRepository')
const { publishPost } = require('../services/publisher')
const { probeVideo, isShortEligible } = require('../services/videoProbe')
const { PLATFORMS, REPEATS, parseId, serverError, isAdminRole } = require('../utils/http')

const router = Router()

// Extensões/mimetypes aceitos, com base na assinatura binária real do arquivo
// (não no Content-Type declarado pelo cliente, que é facilmente falsificável).
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'
])

// Salva com nome aleatório e extensão neutra (.bin); a extensão real é
// corrigida depois que o tipo do arquivo é verificado por assinatura binária.
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../public/uploads'),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + '.bin')
})

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) return cb(null, true)
    cb(new Error('Arquivo precisa ser uma imagem ou vídeo'))
  }
})

// Verifica a assinatura binária real de cada arquivo enviado (o Content-Type
// do multipart é apenas o que o cliente declarou, e pode ser falsificado).
// Renomeia para a extensão correta só depois de confirmar o tipo real;
// remove do disco qualquer arquivo cujo conteúdo não seja imagem/vídeo válido.
async function validarESanitizarUploads(files) {
  const validados = []
  for (const f of files) {
    const tipo = await FileType.fromFile(f.path)
    if (!tipo || !ALLOWED_MEDIA_TYPES.has(tipo.mime)) {
      await fs.promises.unlink(f.path).catch(() => {})
      continue
    }
    const novoPath = f.path.replace(/\.bin$/, `.${tipo.ext}`)
    await fs.promises.rename(f.path, novoPath)
    validados.push({ ...f, path: novoPath, filename: path.basename(novoPath), mimetype: tipo.mime })
  }
  return validados
}

// GET /api/posts
router.get('/', async (req, res) => {
  try {
    const { status } = req.query
    if (status !== undefined && !['scheduled', 'published', 'partial', 'error', 'cancelled'].includes(status)) {
      return res.status(400).json({ erro: 'status inválido' })
    }

    const posts = await repo.listarPosts({ status, userId: req.user.id, isAdmin: isAdminRole(req.user.role) })
    res.json({ posts })
  } catch (e) {
    serverError(res, e)
  }
})

// POST /api/posts
router.post('/', upload.array('media', 10), async (req, res) => {
  try {
    const { text, group, scheduledAt, repeat = 'none', youtubeTitle, youtubeVisibility = 'public' } = req.body

    if (text !== undefined && text.length > 5000)
      return res.status(400).json({ erro: 'O texto do post pode ter no máximo 5000 caracteres.' })
    if (youtubeTitle !== undefined && youtubeTitle.length > 100)
      return res.status(400).json({ erro: 'O título do vídeo pode ter no máximo 100 caracteres.' })
    if (!['public', 'unlisted', 'private'].includes(youtubeVisibility))
      return res.status(400).json({ erro: 'youtubeVisibility inválido. Use public, unlisted ou private.' })
    if (!group || typeof group !== 'string' || group.length > 50)
      return res.status(400).json({ erro: 'Selecione uma estrela/grupo válida.' })

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

    const filesEnviados = req.files || []
    const files = await validarESanitizarUploads(filesEnviados)
    if (files.length < filesEnviados.length) {
      return res.status(400).json({ erro: 'Um ou mais arquivos não são imagens ou vídeos válidos.' })
    }

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
      caption: typeof captions[i] === 'string' ? captions[i].slice(0, 500) : ''
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
    if (platforms.includes('tiktok') && !items.length)
      return res.status(400).json({ erro: 'Falta mídia para publicar no TikTok. Anexe um vídeo ou imagem.' })

    // Instagram exige imagem ou vídeo para publicar.
    if (platforms.includes('instagram') && !items.length)
      return res.status(400).json({ erro: 'Falta imagem ou vídeo para publicar no Instagram. Anexe uma mídia ou desmarque o Instagram.' })

    // A API do Instagram só aceita imagens em JPEG — PNG, GIF e WebP são
    // rejeitados pelo Instagram com um erro genérico só na hora de publicar.
    // Avisamos aqui, no upload, para o usuário entender a causa de imediato.
    if (platforms.includes('instagram')) {
      const imagemNaoSuportada = files.some(f => f.mimetype.startsWith('image/') && f.mimetype !== 'image/jpeg')
      if (imagemNaoSuportada) {
        return res.status(400).json({ erro: 'O Instagram só aceita imagens no formato JPEG. Converta a imagem para JPEG ou desmarque o Instagram.' })
      }
    }

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

    const post = await repo.criarPost({ text: text?.trim() || null, platforms, group_name: group, scheduledAt: scheduledAtUTC, repeat, mediaPath, mediaType, mediaItems, youtubeTitle: youtubeTitle?.trim() || null, youtubeVisibility, youtubeIsShort, userId: req.user.id })
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

    const post = await repo.buscarPostPorId(id, req.user.id, isAdminRole(req.user.role))
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

    const ok = await repo.deletarPost(id, req.user.id, isAdminRole(req.user.role))
    if (!ok) return res.status(404).json({ erro: 'Post não encontrado ou já publicado' })
    res.status(204).send()
  } catch (e) {
    serverError(res, e)
  }
})

module.exports = router
