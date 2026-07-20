// Caso de uso: criar (e opcionalmente publicar imediatamente) um post.
// Orquestra domain (validação/normalização) + infra (repositório, storage,
// probe de vídeo, publisher) — o controller HTTP só traduz req/res para isto.
const postsRepo = require('../../infra/db/postsRepository')
const contasRepo = require('../../repositories/contasRepository')
const { publishPost } = require('../../infra/social/publisher')
const { probeVideo } = require('../../infra/storage/videoProbe')
const { converterParaJpeg } = require('../../infra/storage/mediaConverter')
const { salvarBuffer } = require('../../infra/storage/blobStorage')
const { isShortEligible, isAspectRatioValidForTiktok } = require('../../domain/posts/videoRules')
const { validarCriacaoPost, montarItensMedia, normalizarScheduledAtBR, scheduledAtParaUTC, decidirStatusPublicacao } = require('../../domain/posts/post')
const { ValidationError } = require('../../domain/posts/errors')

const path = require('path')
const os = require('os')
const fs = require('fs')
const crypto = require('crypto')
const { pipeline } = require('stream/promises')

// Instagram e TikTok só aceitam imagens em JPEG — converte antes de publicar,
// em vez de bloquear o post. Para o TikTok, também redimensiona para 9:16.
async function converterMidiasSeNecessario(files, platforms) {
  if (!platforms.includes('instagram') && !platforms.includes('tiktok')) return files
  const resizeForTiktok = platforms.includes('tiktok')

  return Promise.all(files.map(async f => {
    if (!f.mimetype.startsWith('image/')) return f
    if (f.mimetype === 'image/jpeg' && !resizeForTiktok) return f

    const fetchRes = await fetch(f.url)
    // fetch nativo devolve um Web ReadableStream em .body, que o sharp NÃO
    // aceita como input (só Buffer, path ou Node Readable clássico) — sem
    // converter para Buffer aqui, toda conversão pra JPEG falha com
    // "Unsupported input" e o post inteiro quebra com 500.
    const inputBuffer = Buffer.from(await fetchRes.arrayBuffer())
    const jpegBuffer = await converterParaJpeg(inputBuffer, { resizeForTiktok })
    const url = await salvarBuffer(`${crypto.randomUUID()}.jpg`, jpegBuffer, 'image/jpeg')
    return { ...f, url, mimetype: 'image/jpeg' }
  }))
}

// Detecta se algum vídeo é elegível como Shorts do YouTube (vertical/quadrado,
// até 3min) — ffprobe só funciona com um arquivo local, então o vídeo é
// baixado da URL do Blob para um arquivo temporário só para essa leitura de
// metadados, e descartado logo depois.
async function probarVideos(files) {
  return Promise.all(files.map(async f => {
    if (!f.mimetype.startsWith('video/')) return null
    const ext = f.mimetype === 'video/quicktime' ? 'mov' : 'mp4'
    const tmpPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.${ext}`)
    try {
      const fetchRes = await fetch(f.url)
      if (!fetchRes.ok) return null
      await pipeline(fetchRes.body, fs.createWriteStream(tmpPath))
      return await probeVideo(tmpPath)
    } catch {
      return null
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {})
    }
  }))
}

async function criarPost({ body, userId, userRole, isAdmin }) {
  const { text, scheduledAt, repeat = 'none', youtubeTitle, youtubeVisibility = 'public' } = body

  let platforms
  try {
    platforms = JSON.parse(body.platforms || '[]')
  } catch {
    throw new ValidationError('platforms inválido')
  }

  const scheduledAtBR = normalizarScheduledAtBR(scheduledAt)
  if (!scheduledAtBR || Number.isNaN(new Date(scheduledAtBR).getTime())) throw new ValidationError('scheduledAt inválido')
  const scheduledAtUTC = scheduledAtParaUTC(scheduledAtBR)

  // Mídia já foi enviada ao Blob pelo navegador (POST /upload-url + PUT direto) —
  // aqui só recebemos a lista de URLs/metadados resultantes, nunca o binário.
  let media
  try {
    media = Array.isArray(body.media) ? body.media : JSON.parse(body.media || '[]')
  } catch {
    throw new ValidationError('media inválido')
  }
  if (!Array.isArray(media) || media.some(m => !m?.url || !m?.mimetype)) throw new ValidationError('Cada item de media precisa ter url e mimetype')

  const files = await converterMidiasSeNecessario(media, platforms)

  let captions = []
  try {
    captions = JSON.parse(body.captions || '[]')
  } catch {
    throw new ValidationError('captions inválido')
  }

  const probes = await probarVideos(files)
  const items = montarItensMedia(files, captions)

  const mediaPath = items[0]?.path || null
  const mediaType = items[0]?.type || null
  const mediaItems = items.length > 1 ? items : null
  const temVideo = items.some(i => i.type === 'video')
  const aspectRatioValidoTiktok = mediaType === 'video' && probes[0] ? isAspectRatioValidForTiktok(probes[0]) : null

  // "Publicar agora" cria o post já como 'processing' (em vez de 'scheduled')
  // para que o cron do agendamento nunca o veja e dispare uma segunda
  // publicação concorrente — quem publica é só esta requisição, na sequência.
  const publishNow = body.publishNow === 'true' || body.publishNow === true

  const erro = validarCriacaoPost({
    text, youtubeTitle, youtubeVisibility, platforms, repeat, items, temVideo, mediaType, aspectRatioValidoTiktok,
    scheduledAtUTC, publishNow
  })
  if (erro) throw new ValidationError(erro)

  // O post publica em TODAS as contas conectadas de cada rede marcada — não
  // existe mais escolha de 1 conta pelo usuário (ver migrations/027_post_accounts.sql).
  // Se uma rede marcada não tiver nenhuma conta conectada, falha aqui, antes
  // de criar o post — em vez de deixar o publisher descobrir isso depois.
  const contas = await contasRepo.listarContasAtivasPorPlataformas(platforms, userId, isAdmin)
  const platformsSemConta = platforms.filter(p => !contas.some(c => c.platform === p))
  if (platformsSemConta.length) {
    const labels = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
    const nomes = platformsSemConta.map(p => labels[p] || p).join(', ')
    throw new ValidationError(`Nenhuma conta de ${nomes} conectada. Conecte uma conta ou desmarque a rede.`)
  }

  const youtubeIsShort = mediaType === 'video' && probes[0] ? isShortEligible(probes[0]) : null
  const post = await postsRepo.criarPost({
    text: text?.trim() || null, platforms, scheduledAt: scheduledAtUTC, repeat,
    mediaPath, mediaType, mediaItems,
    youtubeTitle: youtubeTitle?.trim() || null, youtubeVisibility, youtubeIsShort,
    accountId: null, userId, status: publishNow ? 'processing' : 'scheduled'
  })

  await postsRepo.definirContasDoPost(post.id, contas.map(c => c.id))
  const postAccounts = await postsRepo.listarContasDoPost(post.id)

  if (!publishNow) return { post, status: 201 }

  const results = await publishPost({ ...post, mediaPath, mediaType, mediaItems, accounts: postAccounts, userId, userRole })
  const status = decidirStatusPublicacao(results)
  // success: 'pending' (Instagram aguardando processamento) não é status
  // final — o post fica em 'processing' até o cron confirmar via finalizarInstagramPendentes().
  if (status !== 'processing') await postsRepo.atualizarStatusPost(post.id, status)

  return { post: { ...post, status, results }, status: 201 }
}

module.exports = { criarPost }
