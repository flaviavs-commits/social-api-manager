// Limites reais de texto por rede — fonte única de verdade, usada tanto pelo
// Agente IA (para não gerar/entregar texto que a rede vai rejeitar) quanto
// por qualquer validação futura do fluxo normal de posts.
//
// O TikTok usa campos separados nas publicações com foto: título de até 90
// caracteres e descrição de até 4.000 caracteres. O texto deste arquivo é a
// descrição/caption por rede; o limite do título é validado em post.js.
const TEXT_LIMITS = {
  instagram: { max: 2200 },
  facebook:  { max: 63206 },
  youtube:   { max: 5000 },     // descrição do vídeo — sem limite rígido documentado; usa o teto genérico do formulário
  tiktok:    { max: 4000 },
}

const YOUTUBE_TITLE_MAX = 100

// Limite de texto efetivo para uma plataforma, dado o tipo de mídia do post.
function limiteTexto(platform, mediaType) {
  const limits = TEXT_LIMITS[platform]
  if (!limits) return null
  return limits.max
}

// Corta o texto no limite da plataforma mais restritiva entre as selecionadas
// para o post, preservando palavras inteiras quando possível (não corta no
// meio de uma palavra, exceto se a palavra sozinha já estourar o limite).
function cortarParaLimite(texto, max) {
  if (!texto || texto.length <= max) return texto
  const cortado = texto.slice(0, max)
  const ultimoEspaco = cortado.lastIndexOf(' ')
  return ultimoEspaco > max * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado
}

// Ajusta um post gerado (texto + título) para caber nos limites reais de
// TODAS as plataformas selecionadas — usa o menor limite entre elas, já que
// o mesmo texto vai para todas. Retorna o post ajustado e a lista de avisos
// (quais plataformas exigiram corte), para o usuário saber que o texto foi
// truncado automaticamente.
function ajustarPostParaPlataformas(post, plataformas, mediaType) {
  const limites = plataformas
    .map(p => limiteTexto(p, mediaType))
    .filter(l => l != null)

  const avisos = []
  let texto = post.texto || ''
  if (limites.length) {
    const menorLimite = Math.min(...limites)
    if (texto.length > menorLimite) {
      texto = cortarParaLimite(texto, menorLimite)
      const platsQueLimitam = plataformas.filter(p => limiteTexto(p, mediaType) === menorLimite)
      avisos.push(`Texto ajustado para ${menorLimite} caracteres (limite de ${platsQueLimitam.join(', ')})`)
    }
  }

  let titulo = post.titulo || ''
  if (plataformas.includes('youtube') && titulo.length > YOUTUBE_TITLE_MAX) {
    titulo = cortarParaLimite(titulo, YOUTUBE_TITLE_MAX)
    avisos.push(`Título do YouTube ajustado para ${YOUTUBE_TITLE_MAX} caracteres`)
  }
  if (plataformas.includes('tiktok') && titulo.length > 90) {
    titulo = cortarParaLimite(titulo, 90)
    avisos.push('Título do TikTok ajustado para 90 caracteres')
  }

  return { post: { ...post, texto, titulo }, avisos }
}

module.exports = { TEXT_LIMITS, YOUTUBE_TITLE_MAX, limiteTexto, cortarParaLimite, ajustarPostParaPlataformas }
