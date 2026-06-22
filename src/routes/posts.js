const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const multer = require('multer')
const FileType = require('file-type')
const sharp = require('sharp')
const repo = require('../repositories/postsRepository')
const contasRepo = require('../repositories/contasRepository')
const { publishPost } = require('../services/publisher')
const metricsService = require('../services/metricsService')
const commentsService = require('../services/commentsService')
const instagramReconcileService = require('../services/instagramReconcileService')
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
  // Cada arquivo é validado/renomeado de forma independente — paraleliza para não
  // pagar o custo de I/O (leitura de assinatura binária + rename) de forma serial
  // quando o post tem várias mídias (carrossel).
  const validados = await Promise.all(files.map(async f => {
    const tipo = await FileType.fromFile(f.path)
    if (!tipo || !ALLOWED_MEDIA_TYPES.has(tipo.mime)) {
      await fs.promises.unlink(f.path).catch(() => {})
      return null
    }
    const novoPath = f.path.replace(/\.bin$/, `.${tipo.ext}`)
    await fs.promises.rename(f.path, novoPath)
    return { ...f, path: novoPath, filename: path.basename(novoPath), mimetype: tipo.mime }
  }))
  return validados.filter(Boolean)
}

// A API do Instagram só aceita imagens em JPEG — PNG, GIF e WebP são
// rejeitados na hora de publicar com um erro genérico ("The image format is
// not supported"). Em vez de bloquear o upload, convertemos a imagem para
// JPEG aqui, mantendo o arquivo original para as demais plataformas.
async function converterImagemParaJpegSeNecessario(file) {
  if (!file.mimetype.startsWith('image/') || file.mimetype === 'image/jpeg') return file

  const novoPath = file.path.replace(/\.\w+$/, '.jpg')
  await sharp(file.path).jpeg({ quality: 90 }).toFile(novoPath)
  await fs.promises.unlink(file.path).catch(() => {})

  return { ...file, path: novoPath, filename: path.basename(novoPath), mimetype: 'image/jpeg' }
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

// GET /api/posts/analytics - posts publicados por dia/rede + métricas reais (likes/comentários)
router.get('/analytics', async (req, res) => {
  try {
    // Tenta recuperar o ID externo de posts antigos do Instagram (publicados
    // antes de existir essa coluna), casando com os posts reais da conta por
    // data/texto. Roda antes de listar para que esses posts já apareçam com
    // métricas nesta mesma chamada. Falha silenciosa: se a API do Instagram
    // estiver fora ou sem permissão, a tela de Analytics continua funcionando
    // normalmente só com os posts que já tinham o ID salvo.
    try {
      await instagramReconcileService.reconciliarPostsInstagram(req.user.id, isAdminRole(req.user.role))
    } catch {}

    const posts = await repo.listarPosts({ status: 'published', userId: req.user.id, isAdmin: isAdminRole(req.user.role) })

    // Série diária por plataforma, a partir da data real de publicação
    // (cai para a data de criação se publishedAt ainda não tiver sido salvo).
    const porDia = {}
    for (const p of posts) {
      const base = p.publishedAt || p.criado_em
      const dia = new Date(base).toISOString().slice(0, 10)
      porDia[dia] = porDia[dia] || {}
      for (const plat of p.platforms) {
        porDia[dia][plat] = (porDia[dia][plat] || 0) + 1
      }
    }

    // Métricas reais só existem para posts com external_post_id, ou seja,
    // publicados a partir desta funcionalidade. Limita aos mais recentes para
    // não disparar uma chamada de API externa por post em contas com muito
    // histórico — isso já é paralelizado (Promise.allSettled), mas o tempo
    // total ainda é limitado pelo timeout individual de cada chamada.
    const MAX_POSTS_COM_METRICAS = 30
    const comExternalId = posts
      .filter(p => p.externalPostId)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, MAX_POSTS_COM_METRICAS)
    const metricsResults = await Promise.allSettled(
      comExternalId.map(p => metricsService.buscarMetricasPost({ ...p, userRole: req.user.role }))
    )

    const metrics = comExternalId.map((p, i) => ({
      postId: p.id,
      platform: p.externalPlatform,
      text: p.text,
      publishedAt: p.publishedAt,
      mediaPath: p.mediaPath,
      mediaType: p.mediaType,
      mediaItems: p.mediaItems,
      metrics: metricsResults[i].status === 'fulfilled' ? metricsResults[i].value : null
    }))

    // Grava um ponto por dia no histórico de cada post (best-effort — não
    // bloqueia a resposta do Analytics se a escrita falhar).
    await Promise.allSettled(
      metrics.filter(m => m.metrics).map(m => repo.registrarSnapshotMetricas(m.postId, m.metrics))
    )

    // Saldo de seguidores e alcance do Instagram, dia a dia — métrica de
    // conta, não de post. Falha silenciosa (ex: conta sem o scope de
    // insights) para não derrubar o restante do Analytics.
    let instagramFollowers = {}
    try {
      instagramFollowers = await metricsService.buscarSeriesSeguidoresInstagram(req.user.id, isAdminRole(req.user.role))
    } catch {}

    let tiktokStats = {}
    try {
      tiktokStats = await metricsService.buscarSeriesStatsTiktok(req.user.id, isAdminRole(req.user.role))
    } catch {}

    res.json({ series: porDia, metrics, instagramFollowers, tiktokStats })
  } catch (e) {
    serverError(res, e)
  }
})

// GET /api/posts/:id/metrics-history - histórico diário de curtidas/comentários/views de um post
router.get('/:id/metrics-history', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const post = await repo.buscarPostPorId(id, req.user.id, isAdminRole(req.user.role))
    if (!post) return res.status(404).json({ erro: 'Post não encontrado' })

    const history = await repo.buscarHistoricoMetricas(id)
    res.json({ history })
  } catch (e) {
    serverError(res, e)
  }
})

// POST /api/posts
router.post('/', upload.array('media', 10), async (req, res) => {
  try {
    const { text, scheduledAt, repeat = 'none', youtubeTitle, youtubeVisibility = 'public' } = req.body

    if (text !== undefined && text.length > 5000)
      return res.status(400).json({ erro: 'O texto do post pode ter no máximo 5000 caracteres.' })
    if (youtubeTitle !== undefined && youtubeTitle.length > 100)
      return res.status(400).json({ erro: 'O título do vídeo pode ter no máximo 100 caracteres.' })
    if (!['public', 'unlisted', 'private'].includes(youtubeVisibility))
      return res.status(400).json({ erro: 'youtubeVisibility inválido. Use public, unlisted ou private.' })

    let platforms
    try {
      platforms = JSON.parse(req.body.platforms || '[]')
    } catch {
      return res.status(400).json({ erro: 'platforms inválido' })
    }

    if (!Array.isArray(platforms) || !platforms.length || !platforms.every(p => PLATFORMS.includes(p)))
      return res.status(400).json({ erro: `platforms deve ser uma lista com valores de: ${PLATFORMS.join(', ')}` })

    // Conta específica escolhida pelo usuário para publicar (opcional). Se
    // informada, precisa existir, pertencer ao usuário e bater com a
    // plataforma selecionada.
    let accountId = null
    if (req.body.accountId) {
      accountId = parseId(req.body.accountId)
      if (!accountId) return res.status(400).json({ erro: 'accountId inválido' })
      const conta = await contasRepo.buscarContaPorId(accountId, req.user.id, isAdminRole(req.user.role))
      if (!conta) return res.status(400).json({ erro: 'Conta não encontrada' })
      if (!platforms.includes(conta.platform))
        return res.status(400).json({ erro: 'A conta escolhida não pertence à plataforma selecionada' })
    }

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
    let files = await validarESanitizarUploads(filesEnviados)
    if (files.length < filesEnviados.length) {
      return res.status(400).json({ erro: 'Um ou mais arquivos não são imagens ou vídeos válidos.' })
    }

    // O Instagram só aceita imagens em JPEG — converte PNG/GIF/WebP antes de
    // publicar, em vez de bloquear o post.
    if (platforms.includes('instagram')) {
      files = await Promise.all(files.map(converterImagemParaJpegSeNecessario))
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

    // "Publicar agora" cria o post já como 'processing' (em vez de
    // 'scheduled') para que o cron do agendamento nunca o veja e dispare uma
    // segunda publicação concorrente — quem publica é só esta requisição,
    // na sequência, abaixo.
    const publishNow = req.body.publishNow === 'true' || req.body.publishNow === true
    const post = await repo.criarPost({ text: text?.trim() || null, platforms, scheduledAt: scheduledAtUTC, repeat, mediaPath, mediaType, mediaItems, youtubeTitle: youtubeTitle?.trim() || null, youtubeVisibility, youtubeIsShort, accountId, userId: req.user.id, status: publishNow ? 'processing' : 'scheduled' })

    if (!publishNow) return res.status(201).json(post)

    const results = await publishPost({ ...post, mediaPath, mediaType, mediaItems, accountId, userId: req.user.id, userRole: req.user.role })
    const status = results.every(r => r.success) ? 'published'
      : results.some(r => r.success) ? 'partial'
      : 'error'
    await repo.atualizarStatusPost(post.id, status)

    res.status(201).json({ ...post, status, results })
  } catch (e) {
    serverError(res, e, 'Não foi possível agendar o post')
  }
})

// GET /api/posts/:id/comments - lista comentários reais do post na rede social
router.get('/:id/comments', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const post = await repo.buscarPostPorId(id, req.user.id, isAdminRole(req.user.role))
    if (!post) return res.status(404).json({ erro: 'Post não encontrado' })

    const { comments } = await commentsService.listarComentariosPost(post)
    const midiaRemota = await commentsService.buscarMidiaPost(post)

    res.json({
      comments,
      post: midiaRemota
        ? { text: midiaRemota.caption || post.text, mediaItems: midiaRemota.itens }
        : { text: post.text, mediaPath: post.mediaPath, mediaType: post.mediaType, mediaItems: post.mediaItems }
    })
  } catch (e) {
    res.status(400).json({ erro: e.message })
  }
})

// POST /api/posts/:id/comments/:commentId/reply - responde um comentário do post na rede social
router.post('/:id/comments/:commentId/reply', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) return res.status(400).json({ erro: 'id inválido' })

    const text = (req.body.text || '').trim()
    if (!text) return res.status(400).json({ erro: 'Escreva uma resposta antes de enviar' })
    if (text.length > 2000) return res.status(400).json({ erro: 'Resposta muito longa (máximo 2000 caracteres)' })

    const post = await repo.buscarPostPorId(id, req.user.id, isAdminRole(req.user.role))
    if (!post) return res.status(404).json({ erro: 'Post não encontrado' })

    const reply = await commentsService.responderComentario(post, req.params.commentId, text)
    res.status(201).json({ reply })
  } catch (e) {
    res.status(400).json({ erro: e.message })
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
