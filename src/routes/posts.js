const { Router } = require('express')
const path = require('path')
const os = require('os')
const fs = require('fs')
const crypto = require('crypto')
const sharp = require('sharp')
const { put, presignUrl, issueSignedToken } = require('@vercel/blob')
const repo = require('../repositories/postsRepository')
const contasRepo = require('../repositories/contasRepository')
const { publishPost } = require('../services/publisher')
const metricsService = require('../services/metricsService')
const commentsService = require('../services/commentsService')
const instagramReconcileService = require('../services/instagramReconcileService')
const { probeVideo, isShortEligible, isAspectRatioValidForTiktok } = require('../services/videoProbe')
const { PLATFORMS, REPEATS, parseId, serverError, isAdminRole } = require('../utils/http')

const router = Router()

// Extensões/mimetypes aceitos, com base na assinatura binária real do arquivo
// (não no Content-Type declarado pelo cliente, que é facilmente falsificável).
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'
])


// POST /api/posts/upload-url — gera uma URL pré-assinada para o navegador
// enviar o arquivo direto ao Vercel Blob, sem passar pelo corpo da
// requisição desta API. Necessário porque funções serverless da Vercel têm
// limite de tamanho de payload (4.5MB no plano Hobby) — vídeos comuns de
// celular já excedem isso facilmente, então o upload precisa ir direto do
// navegador para o storage, não por aqui.
router.post('/upload-url', async (req, res) => {
  try {
    const { filename, mimetype } = req.body || {}
    if (!filename || !mimetype) return res.status(400).json({ erro: 'filename e mimetype são obrigatórios' })
    if (!mimetype.startsWith('image/') && !mimetype.startsWith('video/'))
      return res.status(400).json({ erro: 'Arquivo precisa ser uma imagem ou vídeo' })

    // A checagem de assinatura binária real (que existia no fluxo antigo via
    // multer+file-type) não é possível aqui — o servidor nunca vê o conteúdo
    // do arquivo nesse fluxo. allowedContentTypes/maximumSizeInBytes são a
    // validação equivalente possível num upload direto navegador→Blob.
    const ext = path.extname(filename) || ''
    const pathname = `${crypto.randomUUID()}${ext}`
    const validUntil = Date.now() + 10 * 60 * 1000

    const signed = await issueSignedToken({ pathname, operations: ['put'], validUntil })
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'put',
      pathname,
      access: 'public',
      allowedContentTypes: Array.from(ALLOWED_MEDIA_TYPES),
      maximumSizeInBytes: 200 * 1024 * 1024,
      validUntil
    })

    res.json({ uploadUrl: presignedUrl, mimetype })
  } catch (e) {
    serverError(res, e, 'Não foi possível gerar a URL de upload')
  }
})

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

// GET /api/posts/tiktok-videos - lista os vídeos publicados nas contas do TikTok conectadas
router.get('/tiktok-videos', async (req, res) => {
  try {
    const videos = await metricsService.buscarVideosTiktok(req.user.id, isAdminRole(req.user.role))
    res.json({ videos })
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
// Mídia chega como JSON (array de URLs já enviadas ao Vercel Blob pelo
// navegador via /upload-url), não mais como multipart binário — uploads
// grandes (vídeos) excederiam o limite de payload de uma função serverless
// se passassem por aqui. O parsing do body já é feito pelo express.json()
// global (server.js).
router.post('/', async (req, res) => {
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

    // Mídia já foi enviada ao Blob pelo navegador (POST /upload-url + PUT direto) —
    // aqui só recebemos a lista de URLs/metadados resultantes, nunca o binário.
    let media
    try {
      media = Array.isArray(req.body.media) ? req.body.media : JSON.parse(req.body.media || '[]')
    } catch {
      return res.status(400).json({ erro: 'media inválido' })
    }
    if (!Array.isArray(media) || media.some(m => !m?.url || !m?.mimetype))
      return res.status(400).json({ erro: 'Cada item de media precisa ter url e mimetype' })

    let files = media

    // O Instagram só aceita imagens em JPEG — converte PNG/GIF/WebP antes de
    // publicar, em vez de bloquear o post. Sem o buffer original em mãos (já
    // que o upload foi direto pro Blob), busca o conteúdo via fetch primeiro.
    if (platforms.includes('instagram')) {
      files = await Promise.all(files.map(async f => {
        if (!f.mimetype.startsWith('image/') || f.mimetype === 'image/jpeg') return f
        const res = await fetch(f.url)
        const buffer = Buffer.from(await res.arrayBuffer())
        const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
        const { url } = await put(`${crypto.randomUUID()}.jpg`, jpegBuffer, { access: 'public', contentType: 'image/jpeg' })
        return { ...f, url, mimetype: 'image/jpeg' }
      }))
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

    // Detecta se algum vídeo é elegível como Shorts do YouTube (vertical/quadrado,
    // até 3min) — ffprobe só funciona com um arquivo local, então o vídeo é
    // baixado da URL do Blob para um arquivo temporário só para essa leitura
    // de metadados, e descartado logo depois.
    const probes = await Promise.all(files.map(async f => {
      if (!f.mimetype.startsWith('video/')) return null
      const ext = f.mimetype === 'video/quicktime' ? 'mov' : 'mp4'
      const tmpPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.${ext}`)
      try {
        const res = await fetch(f.url)
        await fs.promises.writeFile(tmpPath, Buffer.from(await res.arrayBuffer()))
        return await probeVideo(tmpPath)
      } catch {
        return null
      } finally {
        await fs.promises.unlink(tmpPath).catch(() => {})
      }
    }))

    const items = files.map((f, i) => ({
      path: f.url,
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
    if (platforms.includes('tiktok') && mediaType === 'video' && probes[0] && !isAspectRatioValidForTiktok(probes[0]))
      return res.status(400).json({ erro: 'O vídeo precisa ter proporção entre 9:16 (vertical) e 16:9 (horizontal) para publicar no TikTok.' })

    // Instagram exige imagem ou vídeo para publicar.
    if (platforms.includes('instagram') && !items.length)
      return res.status(400).json({ erro: 'Falta imagem ou vídeo para publicar no Instagram. Anexe uma mídia ou desmarque o Instagram.' })

    const youtubeIsShort = mediaType === 'video' && probes[0] ? isShortEligible(probes[0]) : null

    // "Publicar agora" cria o post já como 'processing' (em vez de
    // 'scheduled') para que o cron do agendamento nunca o veja e dispare uma
    // segunda publicação concorrente — quem publica é só esta requisição,
    // na sequência, abaixo.
    const publishNow = req.body.publishNow === 'true' || req.body.publishNow === true
    const post = await repo.criarPost({ text: text?.trim() || null, platforms, scheduledAt: scheduledAtUTC, repeat, mediaPath, mediaType, mediaItems, youtubeTitle: youtubeTitle?.trim() || null, youtubeVisibility, youtubeIsShort, accountId, userId: req.user.id, status: publishNow ? 'processing' : 'scheduled' })

    if (!publishNow) return res.status(201).json(post)

    const results = await publishPost({ ...post, mediaPath, mediaType, mediaItems, accountId, userId: req.user.id, userRole: req.user.role })
    // success: 'pending' (Instagram aguardando processamento) não conta como
    // sucesso nem falha ainda — o post fica em 'processing' até o cron
    // confirmar o resultado real via finalizarInstagramPendentes().
    const pendente = results.some(r => r.success === 'pending')
    const sucesso = r => r.success === true
    const status = pendente ? 'processing'
      : results.every(sucesso) ? 'published'
      : results.some(sucesso) ? 'partial'
      : 'error'
    if (!pendente) await repo.atualizarStatusPost(post.id, status)

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
