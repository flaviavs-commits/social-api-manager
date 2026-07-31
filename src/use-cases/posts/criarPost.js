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

// Processa a mídia de UMA rede (conversão de imagem + probe de vídeo +
// montagem dos itens finais) — mesmo pipeline usado para a mídia
// compartilhada, extraído para ser reaproveitado por rede quando o usuário
// anexa mídia independente num card (mediaByPlatform). Ver migrations/035.
async function processarMidia(media, captions, platforms) {
  const files = await converterMidiasSeNecessario(media, platforms)
  const probes = await probarVideos(files)
  const items = montarItensMedia(files, captions)
  const mediaType = items[0]?.type || null
  const aspectRatioValidoTiktok = mediaType === 'video' && probes[0] ? isAspectRatioValidForTiktok(probes[0]) : null
  const shortElegivel = mediaType === 'video' && probes[0] ? isShortEligible(probes[0]) : null
  return { items, mediaType, aspectRatioValidoTiktok, shortElegivel }
}

async function criarPost({ body, userId, userRole, isAdmin }) {
  const { text, scheduledAt, repeat = 'none', youtubeTitle, youtubeVisibility = 'public', youtubeCategoryId, youtubeFormat, igFormat, tiktokPrivacyLevel, locationId, locationName, firstComment, threadsReplyControl } = body

  // "true"/"false" (form-data) ou boolean já parseado (JSON) — undefined
  // quando o campo não veio, para a validação distinguir "não escolheu" de
  // "escolheu não". Ver domain/posts/post.js (obrigatório quando inclui youtube).
  let youtubeMadeForKids
  if (body.youtubeMadeForKids === 'true' || body.youtubeMadeForKids === true) youtubeMadeForKids = true
  else if (body.youtubeMadeForKids === 'false' || body.youtubeMadeForKids === false) youtubeMadeForKids = false

  // Interações do TikTok (comentário/duet/stitch) — desmarcadas por padrão
  // nas checkboxes do frontend (permitido = não desabilitado), então
  // "não veio no body" também significa "permitido" (false), não obrigatório
  // escolher como o privacyLevel. Ver domain/posts/post.js.
  const tiktokDisableComment = body.tiktokDisableComment === 'true' || body.tiktokDisableComment === true
  const tiktokDisableDuet = body.tiktokDisableDuet === 'true' || body.tiktokDisableDuet === true
  const tiktokDisableStitch = body.tiktokDisableStitch === 'true' || body.tiktokDisableStitch === true

  let platforms
  try {
    platforms = JSON.parse(body.platforms || '[]')
  } catch {
    throw new ValidationError('platforms inválido')
  }

  // Contas específicas escolhidas no modal "Gerenciar contas específicas"
  // (ex.: só 1 das 2 contas de Instagram conectadas) — opcional, por
  // compatibilidade com quem ainda não manda accountIds (nesse caso, cai no
  // comportamento antigo de publicar em todas as contas de cada rede
  // marcada, resolvido mais abaixo). Ver contasRepository.listarContasPorIds.
  let accountIds = null
  try {
    const parsed = JSON.parse(body.accountIds || 'null')
    if (Array.isArray(parsed) && parsed.length) accountIds = parsed.map(Number)
  } catch {
    throw new ValidationError('accountIds inválido')
  }

  // Texto diferente por rede (Agendador manual, seletor de abas) — opcional,
  // só contém as plataformas cujo texto foi explicitamente diferenciado do
  // texto principal (text). Ver domain/posts/post.js e migrations/029.
  let textByPlatform = null
  try {
    const parsed = JSON.parse(body.textByPlatform || '{}')
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) textByPlatform = parsed
  } catch {
    throw new ValidationError('textByPlatform inválido')
  }

  // Título diferente por rede (hoje só o YouTube usa título) — mesmo padrão
  // de textByPlatform. Ver domain/posts/post.js e migrations/032.
  let titleByPlatform = null
  try {
    const parsed = JSON.parse(body.titleByPlatform || '{}')
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) titleByPlatform = parsed
  } catch {
    throw new ValidationError('titleByPlatform inválido')
  }

  const scheduledAtBR = normalizarScheduledAtBR(scheduledAt)
  if (!scheduledAtBR || Number.isNaN(new Date(scheduledAtBR).getTime())) throw new ValidationError('scheduledAt inválido')
  const scheduledAtUTC = scheduledAtParaUTC(scheduledAtBR)

  // Mídia já foi enviada ao Blob pelo navegador (POST /upload-url + PUT direto) —
  // aqui só recebemos a lista de URLs/metadados resultantes, nunca o binário.
  // Esta é a mídia COMPARTILHADA — usada por qualquer rede que não tenha
  // mídia própria em mediaByPlatform. Ver migrations/035.
  let media
  try {
    media = Array.isArray(body.media) ? body.media : JSON.parse(body.media || '[]')
  } catch {
    throw new ValidationError('media inválido')
  }
  if (!Array.isArray(media) || media.some(m => !m?.url || !m?.mimetype)) throw new ValidationError('Cada item de media precisa ter url e mimetype')

  let captions = []
  try {
    captions = JSON.parse(body.captions || '[]')
  } catch {
    throw new ValidationError('captions inválido')
  }

  // Mídia independente por rede (tela de cards) — opcional, só contém as
  // plataformas cujo usuário anexou mídia diferente da compartilhada. Mesmo
  // padrão de textByPlatform/titleByPlatform. Ver migrations/035.
  let mediaByPlatform = {}
  try {
    const parsed = JSON.parse(body.mediaByPlatform || '{}')
    if (parsed && typeof parsed === 'object') mediaByPlatform = parsed
  } catch {
    throw new ValidationError('mediaByPlatform inválido')
  }
  let captionsByPlatform = {}
  try {
    const parsed = JSON.parse(body.captionsByPlatform || '{}')
    if (parsed && typeof parsed === 'object') captionsByPlatform = parsed
  } catch {
    throw new ValidationError('captionsByPlatform inválido')
  }
  for (const [platform, mediaDaRede] of Object.entries(mediaByPlatform)) {
    if (!Array.isArray(mediaDaRede) || mediaDaRede.some(m => !m?.url || !m?.mimetype))
      throw new ValidationError(`Cada item de mediaByPlatform.${platform} precisa ter url e mimetype`)
  }

  const { items, mediaType, aspectRatioValidoTiktok, shortElegivel: shortElegivelCompartilhado } = await processarMidia(media, captions, platforms)
  const mediaPath = items[0]?.path || null
  const mediaItems = items.length > 1 ? items : null

  // Processa a mídia própria de cada rede que tiver (em paralelo) — o
  // resultado alimenta tanto a validação por rede (domain/posts/post.js)
  // quanto o que é gravado em post_accounts.media_items por conta.
  const platformsComMidiaPropria = Object.keys(mediaByPlatform).filter(p => platforms.includes(p))
  const resultadosPorPlataforma = await Promise.all(
    platformsComMidiaPropria.map(p => processarMidia(mediaByPlatform[p], captionsByPlatform[p] || [], [p]))
  )
  const itemsByPlatform = {}
  const aspectRatioValidoTiktokByPlatform = {}
  const shortElegivelByPlatform = {}
  platformsComMidiaPropria.forEach((p, i) => {
    itemsByPlatform[p] = resultadosPorPlataforma[i].items
    aspectRatioValidoTiktokByPlatform[p] = resultadosPorPlataforma[i].aspectRatioValidoTiktok
    shortElegivelByPlatform[p] = resultadosPorPlataforma[i].shortElegivel
  })

  // "Publicar agora" cria o post já como 'processing' (em vez de 'scheduled')
  // para que o cron do agendamento nunca o veja e dispare uma segunda
  // publicação concorrente — quem publica é só esta requisição, na sequência.
  const publishNow = body.publishNow === 'true' || body.publishNow === true

  const erro = validarCriacaoPost({
    text, textByPlatform, youtubeTitle, titleByPlatform, youtubeVisibility, youtubeCategoryId, youtubeFormat, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, threadsReplyControl,
    platforms, repeat, items, mediaType, aspectRatioValidoTiktok, itemsByPlatform, aspectRatioValidoTiktokByPlatform,
    scheduledAtUTC, publishNow
  })
  if (erro) throw new ValidationError(erro)

  // Com accountIds, publica só nas contas escolhidas pelo usuário no modal
  // "Gerenciar contas específicas" (ex.: 1 de 2 contas de Instagram). Sem
  // accountIds (compatibilidade), publica em TODAS as contas conectadas de
  // cada rede marcada, como sempre foi (ver migrations/027_post_accounts.sql).
  // Se uma rede marcada não acabar resolvendo nenhuma conta, falha aqui,
  // antes de criar o post — em vez de deixar o publisher descobrir isso depois.
  const contas = accountIds
    ? await contasRepo.listarContasPorIds(accountIds, userId, isAdmin)
    : await contasRepo.listarContasAtivasPorPlataformas(platforms, userId, isAdmin)
  if (accountIds && contas.length !== accountIds.length) {
    throw new ValidationError('Uma ou mais contas selecionadas não foram encontradas ou não pertencem a você.')
  }
  const platformsSemConta = platforms.filter(p => !contas.some(c => c.platform === p))
  if (platformsSemConta.length) {
    const labels = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', threads: 'Threads', linkedin: 'LinkedIn', pinterest: 'Pinterest' }
    const nomes = platformsSemConta.map(p => labels[p] || p).join(', ')
    throw new ValidationError(`Nenhuma conta de ${nomes} conectada. Conecte uma conta ou desmarque a rede.`)
  }

  // Elegibilidade a Short considera a mídia própria do YouTube quando houver,
  // senão a compartilhada — mesmo fallback usado na validação.
  const shortElegivel = shortElegivelByPlatform.youtube ?? shortElegivelCompartilhado
  // Escolha explícita do usuário sobrescreve o cálculo automático; sem
  // escolha, comportamento de sempre (decidido pela proporção/duração).
  const youtubeIsShort = youtubeFormat ? youtubeFormat === 'short' : shortElegivel

  // Aviso não-bloqueante: usuário forçou "Short" num vídeo que não tem
  // proporção/duração típica — o YouTube pode não exibi-lo como tal, mas o
  // post ainda é criado normalmente (decisão de produto: avisar, não bloquear).
  const warnings = []
  if (youtubeFormat === 'short' && shortElegivel === false) {
    warnings.push('O vídeo não tem proporção/duração típica de Short — o YouTube pode não exibi-lo como tal.')
  }

  // Localização (Facebook/Instagram, only) e primeiro comentário automático
  // (Facebook/Instagram/YouTube/Threads/LinkedIn — não TikTok/Pinterest, sem
  // endpoint de comentário na API oficial) — ver publisher.js/scheduler.js.
  const temFacebookOuInstagram = platforms.includes('facebook') || platforms.includes('instagram')

  const post = await postsRepo.criarPost({
    text: text?.trim() || null, textByPlatform, titleByPlatform, platforms, scheduledAt: scheduledAtUTC, repeat,
    mediaPath, mediaType, mediaItems,
    youtubeTitle: youtubeTitle?.trim() || null, youtubeVisibility, youtubeCategoryId: youtubeCategoryId || null,
    youtubeFormat: youtubeFormat || null, youtubeIsShort, youtubeMadeForKids: youtubeMadeForKids ?? null, igFormat: igFormat || null,
    tiktokPrivacyLevel: platforms.includes('tiktok') ? tiktokPrivacyLevel : null,
    tiktokDisableComment: platforms.includes('tiktok') ? tiktokDisableComment : null,
    tiktokDisableDuet: platforms.includes('tiktok') ? tiktokDisableDuet : null,
    tiktokDisableStitch: platforms.includes('tiktok') ? tiktokDisableStitch : null,
    locationId: temFacebookOuInstagram ? (locationId || null) : null,
    locationName: temFacebookOuInstagram ? (locationName || null) : null,
    firstComment: firstComment?.trim() || null,
    threadsReplyControl: platforms.includes('threads') ? (threadsReplyControl || null) : null,
    accountId: null, userId, status: publishNow ? 'processing' : 'scheduled'
  })

  await postsRepo.definirContasDoPost(post.id, contas, itemsByPlatform)
  const postAccounts = await postsRepo.listarContasDoPost(post.id)

  if (!publishNow) return { post: { ...post, warnings }, status: 201 }

  const results = await publishPost({ ...post, mediaPath, mediaType, mediaItems, accounts: postAccounts, userId, userRole })
  const status = decidirStatusPublicacao(results)
  // success: 'pending' (Instagram aguardando processamento) não é status
  // final — o post fica em 'processing' até o cron confirmar via finalizarInstagramPendentes().
  if (status !== 'processing') await postsRepo.atualizarStatusPost(post.id, status)

  return { post: { ...post, status, results, warnings }, status: 201 }
}

module.exports = { criarPost }
