// Regras puras do domínio de posts — sem I/O (sem DB, sem fetch, sem fs).
// Tudo aqui recebe dados já carregados e devolve decisões/valores, nunca efeitos colaterais.

const { PLATFORMS, REPEATS } = require('../../utils/http')

const MAX_TEXT_LENGTH = 5000
const MAX_YOUTUBE_TITLE_LENGTH = 100
const MAX_CAPTION_LENGTH = 500
const YOUTUBE_VISIBILITIES = ['public', 'unlisted', 'private']
const TIKTOK_PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']
const THREADS_REPLY_CONTROLS = ['everyone', 'accounts_you_follow', 'mentioned_only']
const LINKEDIN_VISIBILITIES = ['PUBLIC', 'CONNECTIONS']
const INSTAGRAM_MIN_ANTECEDENCIA_MIN = 20

// Categorias oficiais da YouTube Data API v3 (videoCategories.list, região
// global/US — os IDs são os mesmos em qualquer região, só o label muda por
// idioma). Lista fixa em vez de consultar a API a cada post: os IDs não
// mudam com frequência, e evita uma chamada extra só para popular um select.
const YOUTUBE_CATEGORIES = [
  { id: '1',  label: 'Filmes e animação' },
  { id: '2',  label: 'Carros e veículos' },
  { id: '10', label: 'Música' },
  { id: '15', label: 'Animais' },
  { id: '17', label: 'Esportes' },
  { id: '19', label: 'Viagens e eventos' },
  { id: '20', label: 'Games' },
  { id: '22', label: 'Pessoas e blogs' },
  { id: '23', label: 'Comédia' },
  { id: '24', label: 'Entretenimento' },
  { id: '25', label: 'Notícias e política' },
  { id: '26', label: 'Como fazer e estilo' },
  { id: '27', label: 'Educação' },
  { id: '28', label: 'Ciência e tecnologia' },
]
const YOUTUBE_CATEGORY_IDS = YOUTUBE_CATEGORIES.map(c => c.id)

// Formatos de publicação escolhíveis pelo usuário — opcionais, sem escolha
// cai no comportamento automático já existente (vídeo no Instagram vira Reel
// por padrão; YouTube decide Short via proporção/duração do vídeo).
const INSTAGRAM_FORMATS = ['post', 'reel', 'story']
const YOUTUBE_FORMATS = ['video', 'short']

// Resolve os dados de mídia relevantes para validar UMA rede: usa os itens
// próprios dela (mediaByPlatform[platform], quando o usuário anexou mídia
// independente naquele card) ou cai nos itens compartilhados do post — mesmo
// fallback usado em publisher.js/publicarNaConta e nas demais camadas. Ver
// migrations/035 (mídia independente por rede).
function resolverMidiaDaRede(platform, { itemsByPlatform, items, mediaType, aspectRatioValidoTiktokByPlatform, aspectRatioValidoTiktok }) {
  const proprios = itemsByPlatform?.[platform]
  if (!proprios) return { itemsResolvidos: items, mediaTypeResolvido: mediaType, aspectRatioResolvido: aspectRatioValidoTiktok }
  return {
    itemsResolvidos: proprios,
    mediaTypeResolvido: proprios.length === 1 ? proprios[0].type : (proprios.some(i => i.type === 'video') ? 'video' : 'image'),
    aspectRatioResolvido: aspectRatioValidoTiktokByPlatform?.[platform] ?? null
  }
}

// Valida os campos de criação de um post. Retorna a mensagem de erro (string)
// ou null se tudo estiver correto — quem chama decide o código HTTP.
//
// items/temVideo/mediaType/aspectRatioValidoTiktok descrevem a mídia
// COMPARTILHADA (usada por redes sem mídia própria no card). itemsByPlatform/
// aspectRatioValidoTiktokByPlatform (opcionais) trazem a mídia INDEPENDENTE
// de cada rede quando o usuário anexou algo diferente naquele card — nesse
// caso as regras de "cada rede exige tal mídia" validam contra os itens
// daquela rede específica, não mais contra a lista global.
function validarCriacaoPost({ text, textByPlatform, youtubeTitle, titleByPlatform, youtubeVisibility, youtubeCategoryId, youtubeFormat, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, threadsReplyControl, linkedinVisibility, platforms, repeat, items, temVideo, mediaType, aspectRatioValidoTiktok, itemsByPlatform, aspectRatioValidoTiktokByPlatform, scheduledAtUTC, publishNow }) {
  if (text !== undefined && text !== null && text.length > MAX_TEXT_LENGTH)
    return `O texto do post pode ter no máximo ${MAX_TEXT_LENGTH} caracteres.`

  if (textByPlatform) {
    for (const texto of Object.values(textByPlatform)) {
      if (typeof texto === 'string' && texto.length > MAX_TEXT_LENGTH)
        return `O texto do post pode ter no máximo ${MAX_TEXT_LENGTH} caracteres.`
    }
  }

  if (youtubeTitle !== undefined && youtubeTitle !== null && youtubeTitle.length > MAX_YOUTUBE_TITLE_LENGTH)
    return `O título do vídeo pode ter no máximo ${MAX_YOUTUBE_TITLE_LENGTH} caracteres.`

  if (titleByPlatform) {
    for (const titulo of Object.values(titleByPlatform)) {
      if (typeof titulo === 'string' && titulo.length > MAX_YOUTUBE_TITLE_LENGTH)
        return `O título pode ter no máximo ${MAX_YOUTUBE_TITLE_LENGTH} caracteres.`
    }
  }

  if (!YOUTUBE_VISIBILITIES.includes(youtubeVisibility))
    return 'youtubeVisibility inválido. Use public, unlisted ou private.'

  if (youtubeCategoryId !== undefined && youtubeCategoryId !== null && youtubeCategoryId !== '' && !YOUTUBE_CATEGORY_IDS.includes(youtubeCategoryId))
    return 'youtubeCategoryId inválido.'

  if (youtubeFormat !== undefined && youtubeFormat !== null && youtubeFormat !== '' && !YOUTUBE_FORMATS.includes(youtubeFormat))
    return 'youtubeFormat inválido. Use video ou short.'

  if (igFormat !== undefined && igFormat !== null && igFormat !== '' && !INSTAGRAM_FORMATS.includes(igFormat))
    return 'igFormat inválido. Use post, reel ou story.'

  // Opcional — sem escolha, o Threads usa o próprio default da API
  // ("everyone"), diferente da privacidade do TikTok, que é obrigatória.
  if (threadsReplyControl !== undefined && threadsReplyControl !== null && threadsReplyControl !== '' && !THREADS_REPLY_CONTROLS.includes(threadsReplyControl))
    return 'threadsReplyControl inválido. Use everyone, accounts_you_follow ou mentioned_only.'

  // Opcional — sem escolha, o LinkedIn usa PUBLIC (mesmo default de antes
  // desta coluna existir).
  if (linkedinVisibility !== undefined && linkedinVisibility !== null && linkedinVisibility !== '' && !LINKEDIN_VISIBILITIES.includes(linkedinVisibility))
    return 'linkedinVisibility inválido. Use PUBLIC ou CONNECTIONS.'

  if (!Array.isArray(platforms) || !platforms.length || !platforms.every(p => PLATFORMS.includes(p)))
    return `platforms deve ser uma lista com valores de: ${PLATFORMS.join(', ')}`

  if (!REPEATS.includes(repeat))
    return `repeat inválido. Use um de: ${REPEATS.join(', ')}`

  // "Publicar agora" não passa scheduledAtUTC — só agendamento futuro é
  // validado aqui.
  if (!publishNow && scheduledAtUTC && new Date(scheduledAtUTC + 'Z').getTime() < Date.now())
    return 'A data de publicação não pode estar no passado.'

  // Considera mídia própria de qualquer rede (não só a compartilhada) — com
  // mídia independente por card, é possível não ter mídia global nenhuma e
  // ainda assim ter anexado algo em pelo menos um dos cards.
  const temAlgumaMidia = items.length > 0 || Object.values(itemsByPlatform || {}).some(arr => arr?.length > 0)
  if (!text?.trim() && !temAlgumaMidia)
    return 'Informe o texto do post ou anexe uma imagem/vídeo'

  const midiaContext = { itemsByPlatform, items, mediaType, aspectRatioValidoTiktokByPlatform, aspectRatioValidoTiktok }

  if (platforms.includes('youtube')) {
    const { itemsResolvidos } = resolverMidiaDaRede('youtube', midiaContext)
    if (!itemsResolvidos.some(i => i.type === 'video'))
      return 'Falta vídeo para publicar no YouTube. Anexe um vídeo ou desmarque o YouTube.'
  }

  if (platforms.includes('youtube') && !youtubeTitle?.trim() && !titleByPlatform?.youtube?.trim())
    return 'Informe o título do vídeo para publicar no YouTube.'

  // A API do YouTube (status.selfDeclaredMadeForKids) exige essa declaração em
  // todo upload, por exigência legal da FTC/COPPA — não existe valor default
  // seguro para decidir por conta própria, o usuário precisa escolher.
  if (platforms.includes('youtube') && typeof youtubeMadeForKids !== 'boolean')
    return 'Informe se o vídeo é feito para crianças (obrigatório pelo YouTube).'

  if (platforms.includes('tiktok')) {
    const { itemsResolvidos, mediaTypeResolvido, aspectRatioResolvido } = resolverMidiaDaRede('tiktok', midiaContext)
    if (!itemsResolvidos.length)
      return 'Falta mídia para publicar no TikTok. Anexe um vídeo ou imagem.'
    if (mediaTypeResolvido === 'video' && aspectRatioResolvido === false)
      return 'O vídeo precisa ter proporção entre 9:16 (vertical) e 16:9 (horizontal) para publicar no TikTok.'
  }

  // Exigência das Content Sharing Guidelines do TikTok: a privacidade não
  // pode ter um valor default escolhido pelo backend, o usuário precisa
  // selecionar explicitamente na tela antes de publicar.
  if (platforms.includes('tiktok') && !TIKTOK_PRIVACY_LEVELS.includes(tiktokPrivacyLevel))
    return 'Escolha quem pode ver o vídeo no TikTok antes de publicar.'

  if (platforms.includes('instagram')) {
    const { itemsResolvidos } = resolverMidiaDaRede('instagram', midiaContext)
    if (!itemsResolvidos.length)
      return 'Falta imagem ou vídeo para publicar no Instagram. Anexe uma mídia ou desmarque o Instagram.'
    // Stories não suporta carrossel na Graph API do Instagram — só 1 item por vez.
    if (igFormat === 'story' && itemsResolvidos.length > 1)
      return 'Stories do Instagram não suportam carrossel. Escolha Post ou Reel, ou remova os itens extras.'
  }

  // O Instagram processa a mídia de forma assíncrona antes de publicar
  // (container → aguarda FINISHED → publish) — agendar muito em cima da
  // hora não dá folga pro cron detectar e disparar a tempo. Só vale para
  // agendamento futuro; "publicar agora" não passa por aqui.
  if (platforms.includes('instagram') && !publishNow && scheduledAtUTC) {
    const minutosAteAgendamento = (new Date(scheduledAtUTC + 'Z').getTime() - Date.now()) / 60000
    if (minutosAteAgendamento < INSTAGRAM_MIN_ANTECEDENCIA_MIN)
      return `Para publicar no Instagram, escolha um horário com pelo menos ${INSTAGRAM_MIN_ANTECEDENCIA_MIN} minutos de antecedência.`
  }

  return null
}

// Normaliza os itens de mídia (media + captions) recebidos no corpo da
// requisição para o formato salvo no post.
function montarItensMedia(files, captions) {
  return files.map((f, i) => ({
    path: f.url,
    type: f.mimetype.startsWith('video/') ? 'video' : 'image',
    caption: typeof captions[i] === 'string' ? captions[i].slice(0, MAX_CAPTION_LENGTH) : ''
  }))
}

// scheduledAt vem do <input type="datetime-local"> sem timezone (ex:
// "2026-06-15T10:20"), representando o horário de Brasília escolhido pelo
// usuário. Fixa -03:00 explicitamente para não depender do timezone do processo Node.
function normalizarScheduledAtBR(scheduledAt) {
  if (!scheduledAt) return scheduledAt
  const semTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduledAt) && !/[Z+-]\d{2}:?\d{2}$/.test(scheduledAt)
  return semTimezone ? `${scheduledAt}:00-03:00` : scheduledAt
}

// O driver pg grava colunas "timestamp without time zone" usando o horário
// local do processo (sem aplicar o offset da string), então converte
// explicitamente para UTC antes de enviar ao banco.
function scheduledAtParaUTC(scheduledAtBR) {
  return new Date(scheduledAtBR).toISOString().replace('Z', '')
}

// Decide o status final do post a partir dos resultados de publicação em
// cada plataforma. 'pending' (Instagram aguardando processamento) não conta
// como sucesso nem falha ainda — fica 'processing' até o cron confirmar.
function decidirStatusPublicacao(results) {
  const pendente = results.some(r => r.success === 'pending')
  if (pendente) return 'processing'
  const sucesso = r => r.success === true
  if (results.every(sucesso)) return 'published'
  if (results.some(sucesso)) return 'partial'
  return 'error'
}

module.exports = {
  MAX_TEXT_LENGTH, MAX_YOUTUBE_TITLE_LENGTH, MAX_CAPTION_LENGTH, YOUTUBE_VISIBILITIES,
  YOUTUBE_CATEGORIES, YOUTUBE_CATEGORY_IDS, INSTAGRAM_FORMATS, YOUTUBE_FORMATS,
  INSTAGRAM_MIN_ANTECEDENCIA_MIN, TIKTOK_PRIVACY_LEVELS, THREADS_REPLY_CONTROLS, LINKEDIN_VISIBILITIES,
  validarCriacaoPost, montarItensMedia, normalizarScheduledAtBR, scheduledAtParaUTC,
  decidirStatusPublicacao
}
