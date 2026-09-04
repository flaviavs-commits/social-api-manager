// Caso de uso: criar (e opcionalmente publicar imediatamente) um post.
// Orquestra domain (validação/normalização) + infra (repositório, storage,
// probe de vídeo, publisher) — o controller HTTP só traduz req/res para isto.
const postsRepo = require('../../infra/db/postsRepository')
const contasRepo = require('../../repositories/contasRepository')
const { processarPost } = require('../../services/scheduler')
const { probeVideo } = require('../../infra/storage/videoProbe')
const { converterParaJpeg, lerDimensoesImagem, converterImagemParaTiktok, converterVideoParaTiktok, converterVideoParaInstagram } = require('../../infra/storage/mediaConverter')
const { salvarBuffer, isBlobUrl } = require('../../infra/storage/blobStorage')
const { isShortEligible, isAspectRatioValidForTiktok, isAspectRatioValidForInstagram, isVerticalNineBySixteen } = require('../../domain/posts/videoRules')
const { validarCriacaoPost, montarItensMedia, normalizarScheduledAtBR, scheduledAtParaUTC } = require('../../domain/posts/post')
const { parseSelectedAccountIds, validateSelectedAccounts } = require('../../domain/posts/accountSelection')
const { ValidationError } = require('../../domain/posts/errors')
const { registrarLog } = require('../../repositories/logsRepository')

const path = require('path')
const os = require('os')
const fs = require('fs')
const crypto = require('crypto')
const { pipeline } = require('stream/promises')

// Instagram e TikTok recebem imagens em JPEG. Formatos de celular como HEIC,
// PNG, GIF e WebP são convertidos sem reduzir a resolução ou alterar o
// enquadramento original.
// dimensoesPorPath acumula width/height de cada imagem tocada aqui (a
// resolução real que efetivamente será publicada), lido depois em
// processarMidia — evita rebaixar (fetch) a URL final de novo só para medir.
async function converterMidiasSeNecessario(files, platforms, dimensoesPorPath, tamanhosPorPath) {
  if (!platforms.includes('instagram') && !platforms.includes('tiktok')) return files

  return Promise.all(files.map(async f => {
    if (!f.mimetype.startsWith('image/')) return f
    if (f.mimetype === 'image/jpeg') return f

    const fetchRes = await fetch(f.url)
    if (!fetchRes.ok) throw new Error('Não foi possível baixar a imagem para preparar a publicação.')
    // fetch nativo devolve um Web ReadableStream em .body, que o sharp NÃO
    // aceita como input (só Buffer, path ou Node Readable clássico) — sem
    // converter para Buffer aqui, toda conversão pra JPEG falha com
    // "Unsupported input" e o post inteiro quebra com 500.
    const inputBuffer = Buffer.from(await fetchRes.arrayBuffer())
    const jpegBuffer = await converterParaJpeg(inputBuffer, { mimetype: f.mimetype })
    const url = await salvarBuffer(`${crypto.randomUUID()}.jpg`, jpegBuffer, 'image/jpeg')
    if (dimensoesPorPath) dimensoesPorPath[url] = await lerDimensoesImagem(jpegBuffer).catch(() => null)
    if (tamanhosPorPath) tamanhosPorPath[url] = inputBuffer.length
    return { ...f, url, mimetype: 'image/jpeg' }
  }))
}

// Lê width/height de uma imagem que NÃO passou por converterMidiasSeNecessario
// (já era JPEG e nenhuma rede pediu conversão) — precisa rebaixar a URL, já
// que não houve buffer intermediário disponível para medir de graça.
async function lerDimensoesImagemPorUrl(url, tamanhosPorPath) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (tamanhosPorPath) tamanhosPorPath[url] = buffer.length
    return await lerDimensoesImagem(buffer)
  } catch {
    return null
  }
}

// Detecta se algum vídeo é elegível como Short do YouTube (vertical 9:16,
// menos de 60s) — ffprobe só funciona com um arquivo local, então o vídeo é
// baixado da URL do Blob para um arquivo temporário só para essa leitura de
// metadados, e descartado logo depois.
async function probarVideos(files, tamanhosPorPath) {
  return Promise.all(files.map(async f => {
    if (!f.mimetype.startsWith('video/')) return null
    const ext = f.mimetype === 'video/quicktime' ? 'mov' : 'mp4'
    const tmpPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.${ext}`)
    try {
      const fetchRes = await fetch(f.url)
      if (!fetchRes.ok) return null
      await pipeline(fetchRes.body, fs.createWriteStream(tmpPath))
      if (tamanhosPorPath) tamanhosPorPath[f.url] = (await fs.promises.stat(tmpPath)).size
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
// igFormat: formato escolhido para o Instagram ('post'/'reel'/'story') — só
// relevante quando 'instagram' está em platforms; decide a faixa de
// proporção aceita (ver domain/posts/videoRules.js). A mídia permanece na
// resolução original em todas as redes.
async function normalizarVideosTiktok(files, probes, tamanhosPorPath) {
  return Promise.all(files.map(async (file, index) => {
    if (!file.mimetype.startsWith('video/')) return file
    const probe = probes[index]
    if (probe?.width === 1080 && probe?.height === 1920 && file.mimetype === 'video/mp4') return file

    const response = await fetch(file.url)
    if (!response.ok) throw new Error('Não foi possível baixar o vídeo para preparar a versão do TikTok.')
    const inputBuffer = Buffer.from(await response.arrayBuffer())
    const outputBuffer = await converterVideoParaTiktok(inputBuffer)
    const url = await salvarBuffer(`${crypto.randomUUID()}-tiktok.mp4`, outputBuffer, 'video/mp4')
    if (tamanhosPorPath) tamanhosPorPath[url] = tamanhosPorPath[file.url] ?? inputBuffer.length
    return { ...file, url, mimetype: 'video/mp4' }
  }))
}

async function normalizarImagensTiktok(files, dimensoesPorPath, tamanhosPorPath) {
  return Promise.all(files.map(async file => {
    if (!file.mimetype.startsWith('image/')) return file

    const response = await fetch(file.url)
    if (!response.ok) throw new Error('Não foi possível baixar a foto para preparar a versão do TikTok.')
    const inputBuffer = Buffer.from(await response.arrayBuffer())
    const outputBuffer = await converterImagemParaTiktok(inputBuffer)
    const url = await salvarBuffer(`${crypto.randomUUID()}-tiktok.jpg`, outputBuffer, 'image/jpeg')
    if (dimensoesPorPath) dimensoesPorPath[url] = await lerDimensoesImagem(outputBuffer).catch(() => null)
    if (tamanhosPorPath) tamanhosPorPath[url] = tamanhosPorPath[file.url] ?? inputBuffer.length
    return { ...file, url, mimetype: 'image/jpeg' }
  }))
}

async function normalizarVideosInstagram(files, tamanhosPorPath) {
  return Promise.all(files.map(async file => {
    if (!file.mimetype.startsWith('video/')) return file

    const response = await fetch(file.url)
    if (!response.ok) throw new Error('Não foi possível baixar o vídeo para preparar a versão do Instagram.')
    const inputBuffer = Buffer.from(await response.arrayBuffer())
    const outputBuffer = await converterVideoParaInstagram(inputBuffer)
    const url = await salvarBuffer(`${crypto.randomUUID()}-instagram.mp4`, outputBuffer, 'video/mp4')
    if (tamanhosPorPath) tamanhosPorPath[url] = tamanhosPorPath[file.url] ?? inputBuffer.length
    return { ...file, url, mimetype: 'video/mp4' }
  }))
}

async function processarMidia(media, captions, platforms, igFormat, { normalizarTiktok = false, normalizarInstagram = false, facebookFormat = 'post', youtubeFormat } = {}) {
  const dimensoesPorPath = {}
  const tamanhosPorPath = {}
  let files = await converterMidiasSeNecessario(media, platforms, dimensoesPorPath, tamanhosPorPath)
  let probes = await probarVideos(files, tamanhosPorPath)
  // Guarda os metadados do arquivo enviado antes de qualquer cópia para uma
  // rede. A normalização do TikTok pode transformar, por exemplo, 720x1280 em
  // 1080x1920; os limites devem avaliar a mídia original, não mascarar uma
  // resolução abaixo do mínimo com a cópia gerada pelo app.
  const probesOriginais = probes.slice()
  if (normalizarTiktok && platforms.includes('tiktok')) {
    const videoIndex = files.findIndex(file => file.mimetype.startsWith('video/'))
    const videoValido = videoIndex >= 0 && probes[videoIndex]
      ? isAspectRatioValidForTiktok(probes[videoIndex])
      : null
    if (videoIndex < 0 && files.length > 0 && files.every(file => file.mimetype.startsWith('image/'))) {
      files = await normalizarImagensTiktok(files, dimensoesPorPath, tamanhosPorPath)
    } else if (files.length === 1 && videoValido === true) {
      files = await normalizarVideosTiktok(files, probes, tamanhosPorPath)
    }
    probes = await probarVideos(files, tamanhosPorPath)
  }
  if (normalizarInstagram && platforms.includes('instagram')) {
    files = await normalizarVideosInstagram(files, tamanhosPorPath)
    probes = await probarVideos(files, tamanhosPorPath)
  }

  // JPEGs e vídeos que não precisaram de conversão ainda precisam ter o
  // tamanho real conhecido para as regras de cada rede. O navegador envia
  // `file.size` como fallback, mas o valor medido aqui é a fonte confiável.
  await Promise.all(files.map(async file => {
    if (!file.mimetype.startsWith('image/')) return
    const precisaDeTamanho = !Number.isFinite(tamanhosPorPath[file.url])
    const precisaDeDimensoes = platforms.includes('instagram') && !dimensoesPorPath[file.url]
    if (!precisaDeTamanho && !precisaDeDimensoes) return
    const dimensoes = await lerDimensoesImagemPorUrl(file.url, tamanhosPorPath)
    if (dimensoes) dimensoesPorPath[file.url] = dimensoes
  }))

  const items = montarItensMedia(files, captions)
  const mediaType = items[0]?.type || null
  const aspectRatioValidoTiktok = mediaType === 'video' && probes[0] ? isAspectRatioValidForTiktok(probes[0]) : null
  const shortElegivel = mediaType === 'video' ? Boolean(probes[0] && isShortEligible(probes[0])) : null

  let aspectRatioValidoInstagram = null
  if (platforms.includes('instagram') && mediaType) {
    if (mediaType === 'video' && probes[0]) {
      aspectRatioValidoInstagram = isAspectRatioValidForInstagram(probes[0], igFormat || 'post')
    } else if (mediaType === 'image') {
      const primeiraImagem = files.find(f => f.mimetype.startsWith('image/'))
      const dimensoes = primeiraImagem
        ? (dimensoesPorPath[primeiraImagem.url] || await lerDimensoesImagemPorUrl(primeiraImagem.url, tamanhosPorPath))
        : null
      if (dimensoes?.width && dimensoes?.height) aspectRatioValidoInstagram = isAspectRatioValidForInstagram(dimensoes, igFormat || 'post')
    }
  }

  let aspectRatioValidoFacebook = null
  if (platforms.includes('facebook') && facebookFormat === 'reel' && mediaType === 'video') {
    aspectRatioValidoFacebook = probes[0] ? isVerticalNineBySixteen(probes[0]) : null
  }

  const mediaMetadata = files.map((file, index) => {
    const probe = probesOriginais[index] || probes[index]
    const dimensoes = dimensoesPorPath[file.url]
    return {
      type: items[index]?.type || null,
      size: Number.isFinite(tamanhosPorPath[file.url]) ? tamanhosPorPath[file.url] : (Number.isFinite(file.size) ? file.size : null),
      width: probe?.width ?? dimensoes?.width ?? null,
      height: probe?.height ?? dimensoes?.height ?? null,
      duration: probe?.duration ?? null,
    }
  })

  return { items, mediaType, mediaMetadata, aspectRatioValidoTiktok, aspectRatioValidoInstagram, aspectRatioValidoFacebook, shortElegivel }
}

async function criarPost({ body, userId, userRole, isAdmin }) {
  const startedAt = Date.now()
  const { text, scheduledAt, repeat = 'none', youtubeTitle, youtubeVisibility = 'public', youtubeCategoryId, youtubeFormat, igFormat, facebookFormat = 'post', tiktokPrivacyLevel, locationId, locationName, firstComment } = body

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
    accountIds = parseSelectedAccountIds(body.accountIds)
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

  // Título diferente por rede (YouTube e título de foto do TikTok) — mesmo padrão
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
  // Bloqueia SSRF: só aceita mídia que já passou pelo upload direto ao Vercel
  // Blob (POST /upload-url) — o servidor faz fetch() dessas URLs mais adiante
  // (conversão de imagem, probe de vídeo, publishers), então aceitar qualquer
  // URL aqui deixaria um usuário autenticado apontar o servidor para rede
  // interna ou metadata da nuvem.
  if (media.some(m => !isBlobUrl(m.url))) throw new ValidationError('URL de mídia inválida — envie o arquivo pelo upload padrão.')

  let cover = null
  try {
    const parsed = body.cover ? (typeof body.cover === 'object' ? body.cover : JSON.parse(body.cover)) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cover = parsed
  } catch {
    throw new ValidationError('cover inválida')
  }
  if (cover && (!cover.url || !cover.mimetype || !cover.mimetype.startsWith('image/') || !isBlobUrl(cover.url))) {
    throw new ValidationError('A capa precisa ser uma imagem enviada pelo upload padrão.')
  }

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
    if (mediaDaRede.some(m => !isBlobUrl(m.url)))
      throw new ValidationError(`URL de mídia inválida em mediaByPlatform.${platform} — envie o arquivo pelo upload padrão.`)
  }

  // A mídia compartilhada mantém resolução e enquadramento originais em
  // todas as redes; cada API faz o enquadramento final.
  const { items, mediaType, mediaMetadata: mediaMetadataCompartilhada, aspectRatioValidoTiktok, aspectRatioValidoInstagram, aspectRatioValidoFacebook, shortElegivel: shortElegivelCompartilhado } = await processarMidia(media, captions, platforms, igFormat, { facebookFormat, youtubeFormat })
  const mediaPath = items[0]?.path || null
  const mediaItems = items.length > 1 ? items : null
  const coverPath = cover?.url || null
  const coverType = cover?.mimetype || null

  // Processa a mídia própria de cada rede que tiver (em paralelo) — o
  // resultado alimenta tanto a validação por rede (domain/posts/post.js)
  // quanto o que é gravado em post_accounts.media_items por conta. TikTok
  // sempre entra aqui quando está entre as plataformas e é uma foto, para
  // preservar a mídia por rede sem afetar a versão compartilhada. Vídeo do
  // Instagram também ganha uma cópia MP4/H.264 própria, pois a normalização
  // exigida pela API não deve alterar o arquivo usado pelas outras redes.
  // Se o usuário escolheu mídia independente, ela continua sendo respeitada.
  const platformsComMidiaPropria = Object.keys(mediaByPlatform).filter(p => platforms.includes(p))
  const tiktokPrecisaDeVersaoPropria = platforms.includes('tiktok') && !platformsComMidiaPropria.includes('tiktok') && ['image', 'video'].includes(mediaType)
  const instagramPrecisaDeVersaoPropria = platforms.includes('instagram') && !platformsComMidiaPropria.includes('instagram') && mediaType === 'video'
  const todasComMidiaPropria = Array.from(new Set([
    ...platformsComMidiaPropria,
    ...(tiktokPrecisaDeVersaoPropria ? ['tiktok'] : []),
    ...(instagramPrecisaDeVersaoPropria ? ['instagram'] : [])
  ]))

  const resultadosPorPlataforma = await Promise.all(
    todasComMidiaPropria.map(p => {
      const usaMidiaCompartilhada =
        (p === 'tiktok' && tiktokPrecisaDeVersaoPropria) ||
        (p === 'instagram' && instagramPrecisaDeVersaoPropria)
      const origemMedia = usaMidiaCompartilhada ? media : mediaByPlatform[p]
      const origemCaptions = usaMidiaCompartilhada ? captions : (captionsByPlatform[p] || [])
      return processarMidia(origemMedia, origemCaptions, [p], igFormat, {
        normalizarTiktok: p === 'tiktok',
        normalizarInstagram: p === 'instagram',
        facebookFormat,
        youtubeFormat
      })
    })
  )
  const itemsByPlatform = {}
  const aspectRatioValidoTiktokByPlatform = {}
  const aspectRatioValidoInstagramByPlatform = {}
  const aspectRatioValidoFacebookByPlatform = {}
  const shortElegivelByPlatform = {}
  const mediaMetadataByPlatform = {}
  todasComMidiaPropria.forEach((p, i) => {
    itemsByPlatform[p] = resultadosPorPlataforma[i].items
    mediaMetadataByPlatform[p] = resultadosPorPlataforma[i].mediaMetadata
    aspectRatioValidoTiktokByPlatform[p] = resultadosPorPlataforma[i].aspectRatioValidoTiktok
    aspectRatioValidoInstagramByPlatform[p] = resultadosPorPlataforma[i].aspectRatioValidoInstagram
    aspectRatioValidoFacebookByPlatform[p] = resultadosPorPlataforma[i].aspectRatioValidoFacebook
    shortElegivelByPlatform[p] = resultadosPorPlataforma[i].shortElegivel
  })

  // Um post enviado para aprovação também fica fora do fluxo do cron até que
  // um aprovador o libere. Assim a revisão acontece antes de qualquer envio
  // para as redes.
  const requiresApproval = body.requiresApproval === 'true' || body.requiresApproval === true

  // "Publicar agora" cria o post já como 'processing' (em vez de 'scheduled')
  // para que o cron do agendamento nunca o veja e dispare uma segunda
  // publicação concorrente — quem publica é só esta requisição, na sequência.
  const publishNow = body.publishNow === 'true' || body.publishNow === true
  if (requiresApproval && publishNow) throw new ValidationError('Desative "Publicar agora" para enviar o conteúdo para aprovação.')

  const erro = validarCriacaoPost({
    text, textByPlatform, youtubeTitle, titleByPlatform, youtubeVisibility, youtubeCategoryId, youtubeFormat, youtubeMadeForKids, igFormat, facebookFormat, tiktokPrivacyLevel,
    platforms, repeat, items, mediaType, mediaMetadata: mediaMetadataCompartilhada, mediaMetadataByPlatform, aspectRatioValidoTiktok, aspectRatioValidoInstagram, aspectRatioValidoFacebook, shortElegivel: shortElegivelCompartilhado, shortElegivelByPlatform, itemsByPlatform, aspectRatioValidoTiktokByPlatform, aspectRatioValidoInstagramByPlatform, aspectRatioValidoFacebookByPlatform,
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
  const erroDeSelecaoDeContas = accountIds ? validateSelectedAccounts(platforms, contas) : null
  if (erroDeSelecaoDeContas) throw new ValidationError(erroDeSelecaoDeContas)
  const platformsSemConta = platforms.filter(p => !contas.some(c => c.platform === p))
  if (platformsSemConta.length) {
    const labels = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
    const nomes = platformsSemConta.map(p => labels[p] || p).join(', ')
    throw new ValidationError(`Nenhuma conta de ${nomes} conectada. Conecte uma conta ou desmarque a rede.`)
  }

  // Elegibilidade a Short considera a mídia própria do YouTube quando houver,
  // senão a compartilhada — mesmo fallback usado na validação.
  const shortElegivel = shortElegivelByPlatform.youtube ?? shortElegivelCompartilhado
  // Escolha explícita do usuário sobrescreve o cálculo automático; sem
  // escolha, comportamento de sempre (decidido pela proporção/duração).
  const youtubeIsShort = youtubeFormat ? youtubeFormat === 'short' : shortElegivel

  const warnings = []

  // Localização (Facebook/Instagram, only) e primeiro comentário automático
  // (Facebook/Instagram/YouTube — não TikTok, sem endpoint de comentário na
  // API oficial) — ver publisher.js/scheduler.js.
  const temFacebookOuInstagram = platforms.includes('facebook') || platforms.includes('instagram')

  const post = await postsRepo.criarPost({
    text: text?.trim() || null, textByPlatform, titleByPlatform, platforms, scheduledAt: scheduledAtUTC, repeat,
    mediaPath, mediaType, mediaItems, coverPath, coverType,
    youtubeTitle: youtubeTitle?.trim() || null, youtubeVisibility, youtubeCategoryId: youtubeCategoryId || null,
    youtubeFormat: youtubeFormat || null, youtubeIsShort, youtubeMadeForKids: youtubeMadeForKids ?? null, igFormat: igFormat || null, facebookFormat: facebookFormat || null,
    tiktokPrivacyLevel: platforms.includes('tiktok') ? tiktokPrivacyLevel : null,
    tiktokDisableComment: platforms.includes('tiktok') ? tiktokDisableComment : null,
    tiktokDisableDuet: platforms.includes('tiktok') ? tiktokDisableDuet : null,
    tiktokDisableStitch: platforms.includes('tiktok') ? tiktokDisableStitch : null,
    locationId: temFacebookOuInstagram ? (locationId || null) : null,
    locationName: temFacebookOuInstagram ? (locationName || null) : null,
    firstComment: firstComment?.trim() || null,
    accountId: null, userId, status: requiresApproval ? 'pending_approval' : publishNow ? 'processing' : 'scheduled'
  })

  await postsRepo.definirContasDoPost(post.id, contas, itemsByPlatform)
  const postAccounts = await postsRepo.listarContasDoPost(post.id)
  console.info(`[posts] #${post.id} pronto para ${requiresApproval ? 'aprovação' : publishNow ? 'publicação' : 'agendamento'} em ${Date.now() - startedAt}ms`)

  // O histórico é observabilidade: uma falha ao gravá-lo não pode desfazer
  // nem impedir a criação do post já persistido.
  try {
    await registrarLog({
      type: publishNow ? 'info' : 'ok',
      message: requiresApproval
        ? `Post #${post.id} enviado para aprovação`
        : publishNow ? `Post #${post.id} criado e enviado para publicação` : `Post #${post.id} agendado com sucesso`,
      platform: null,
      user_id: userId
    })
  } catch (logError) {
    console.error(`Não foi possível registrar a criação do post #${post.id}:`, logError.message)
  }

  if (!publishNow) return { post: { ...post, status: requiresApproval ? 'pending_approval' : post.status, warnings }, status: 201 }

  // I/O externo (upload/processamento da rede social) não deve manter a
  // requisição HTTP aberta. O mesmo pipeline do scheduler conclui status,
  // logs, retries e notificações em segundo plano.
  setImmediate(() => {
    processarPost({ ...post, mediaPath, mediaType, mediaItems, accounts: postAccounts, userId, userRole })
      .catch(err => console.error(`Erro na publicação assíncrona do post #${post.id}:`, err.message))
  })

  return { post: { ...post, status: 'processing', warnings }, status: 202 }
}

module.exports = { criarPost }
