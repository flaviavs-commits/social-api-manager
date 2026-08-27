const { listarContasToken } = require('../infra/social/publisher')
const postsRepo = require('../infra/db/postsRepository')

const FETCH_TIMEOUT_MS = 4000
// Tolerância de horário ao casar um post do banco com um post real do
// Instagram: o agendamento, upload e processamento da rede social podem
// levar alguns minutos, então não dá para exigir um timestamp exato.
const MATCH_TOLERANCIA_MS = 15 * 60 * 1000

async function fetchComTimeout(url, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function buscarMediaRecente(token) {
  const url = `https://graph.instagram.com/v19.0/me/media?fields=id,caption,timestamp,media_type&limit=50&access_token=${encodeURIComponent(token.accessToken)}`
  const res = await fetchComTimeout(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Instagram respondeu ${res.status}`)
  return data.data || []
}

// Pontua o quão provável é que `media` (post real do Instagram) corresponda
// a `post` (registro salvo no banco): texto igual conta mais que só a data
// estar próxima, já que vários posts podem ter sido publicados na mesma
// janela de tempo.
function pontuarCorrespondencia(post, media) {
  const diffMs = Math.abs(new Date(media.timestamp).getTime() - new Date(post.publishedAtEstimado).getTime())
  if (diffMs > MATCH_TOLERANCIA_MS) return null

  const textoPost = (post.text || '').trim()
  const textoMedia = (media.caption || '').trim()
  const textoIgual = textoPost && textoMedia && textoPost === textoMedia

  return { diffMs, textoIgual }
}

// Para cada conta Instagram conectada do usuário, busca os posts recentes
// reais (/me/media) e tenta casar com posts salvos no banco que ainda não
// têm external_post_id — preenchendo retroativamente para que métricas e
// comentários passem a funcionar também em posts antigos.
async function reconciliarPostsInstagram(userId, isSuperAdmin) {
  const [contas, postsSemId] = await Promise.all([
    listarContasToken('instagram', userId, isSuperAdmin),
    postsRepo.listarPostsPublicadosSemExternalId('instagram', userId, isSuperAdmin)
  ])

  if (!postsSemId.length || !contas.length) return { reconciliados: 0 }

  const postsComEstimativa = postsSemId.map(p => ({
    ...p,
    publishedAtEstimado: p.criado_em || p.scheduledAt
  }))

  // Busca a mídia recente de cada conta em paralelo (chamadas de rede independentes);
  // o casamento com os posts do banco continua sequencial por conta, já que precisa
  // marcar `jaCasado` para não reusar a mesma mídia em duas contas processadas ao
  // mesmo tempo.
  const mediasPorConta = await Promise.all(contas.map(async conta => {
    try {
      return { conta, medias: await buscarMediaRecente(conta) }
    } catch {
      return { conta, medias: null } // conta sem permissão/token inválido — pula, não derruba a reconciliação das outras
    }
  }))

  let reconciliados = 0

  for (const { conta, medias } of mediasPorConta) {
    if (!medias) continue

    for (const media of medias) {
      // Evita reusar a mesma mídia real para dois posts diferentes do banco.
      const candidato = postsComEstimativa
        .filter(p => !p.jaCasado && (!p.accountId || p.accountId === conta.contaId))
        .map(p => ({ post: p, score: pontuarCorrespondencia(p, media) }))
        .filter(c => c.score !== null)
        .sort((a, b) => (b.score.textoIgual - a.score.textoIgual) || (a.score.diffMs - b.score.diffMs))[0]

      if (!candidato) continue

      await postsRepo.salvarPublicacaoExterna(candidato.post.id, {
        externalPostId: media.id,
        externalPlatform: 'instagram',
        publishedAt: media.timestamp,
        // A reconciliação também conhece a conta que devolveu a mídia. Sem
        // esse vínculo, cada refresh inseria outra linha sem account_id e o
        // Analytics contava o mesmo post várias vezes.
        accountId: conta.contaId
      })
      if (!candidato.post.accountId) {
        await postsRepo.definirAccountIdSeVazio(candidato.post.id, conta.contaId)
      }
      candidato.post.jaCasado = true
      reconciliados++
    }
  }

  return { reconciliados }
}

module.exports = { reconciliarPostsInstagram }
