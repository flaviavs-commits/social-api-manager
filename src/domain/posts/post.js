// Regras puras do domínio de posts — sem I/O (sem DB, sem fetch, sem fs).
// Tudo aqui recebe dados já carregados e devolve decisões/valores, nunca efeitos colaterais.

const { PLATFORMS, REPEATS } = require('../../utils/http')

const MAX_TEXT_LENGTH = 5000
const MAX_YOUTUBE_TITLE_LENGTH = 100
const MAX_CAPTION_LENGTH = 500
const YOUTUBE_VISIBILITIES = ['public', 'unlisted', 'private']
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

// Valida os campos de criação de um post. Retorna a mensagem de erro (string)
// ou null se tudo estiver correto — quem chama decide o código HTTP.
function validarCriacaoPost({ text, textByPlatform, youtubeTitle, youtubeVisibility, youtubeCategoryId, youtubeFormat, igFormat, platforms, repeat, items, temVideo, mediaType, aspectRatioValidoTiktok, scheduledAtUTC, publishNow }) {
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

  if (!YOUTUBE_VISIBILITIES.includes(youtubeVisibility))
    return 'youtubeVisibility inválido. Use public, unlisted ou private.'

  if (youtubeCategoryId !== undefined && youtubeCategoryId !== null && youtubeCategoryId !== '' && !YOUTUBE_CATEGORY_IDS.includes(youtubeCategoryId))
    return 'youtubeCategoryId inválido.'

  if (youtubeFormat !== undefined && youtubeFormat !== null && youtubeFormat !== '' && !YOUTUBE_FORMATS.includes(youtubeFormat))
    return 'youtubeFormat inválido. Use video ou short.'

  if (igFormat !== undefined && igFormat !== null && igFormat !== '' && !INSTAGRAM_FORMATS.includes(igFormat))
    return 'igFormat inválido. Use post, reel ou story.'

  if (!Array.isArray(platforms) || !platforms.length || !platforms.every(p => PLATFORMS.includes(p)))
    return `platforms deve ser uma lista com valores de: ${PLATFORMS.join(', ')}`

  if (!REPEATS.includes(repeat))
    return `repeat inválido. Use um de: ${REPEATS.join(', ')}`

  if (!text?.trim() && !items.length)
    return 'Informe o texto do post ou anexe uma imagem/vídeo'

  if (platforms.includes('youtube') && !temVideo)
    return 'Falta vídeo para publicar no YouTube. Anexe um vídeo ou desmarque o YouTube.'

  if (platforms.includes('youtube') && !youtubeTitle?.trim())
    return 'Informe o título do vídeo para publicar no YouTube.'

  if (platforms.includes('tiktok') && !items.length)
    return 'Falta mídia para publicar no TikTok. Anexe um vídeo ou imagem.'

  if (platforms.includes('tiktok') && mediaType === 'video' && aspectRatioValidoTiktok === false)
    return 'O vídeo precisa ter proporção entre 9:16 (vertical) e 16:9 (horizontal) para publicar no TikTok.'

  if (platforms.includes('instagram') && !items.length)
    return 'Falta imagem ou vídeo para publicar no Instagram. Anexe uma mídia ou desmarque o Instagram.'

  // Stories não suporta carrossel na Graph API do Instagram — só 1 item por vez.
  if (platforms.includes('instagram') && igFormat === 'story' && items.length > 1)
    return 'Stories do Instagram não suportam carrossel. Escolha Post ou Reel, ou remova os itens extras.'

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
  INSTAGRAM_MIN_ANTECEDENCIA_MIN,
  validarCriacaoPost, montarItensMedia, normalizarScheduledAtBR, scheduledAtParaUTC,
  decidirStatusPublicacao
}
