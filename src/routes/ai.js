const { Router } = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const { serverError } = require('../utils/http')

const router = Router()

const PLATFORM_HINTS = {
  instagram: 'Instagram: máximo 2200 caracteres, use hashtags relevantes (5-10), emojis são bem-vindos, tom visual e engajante.',
  facebook:  'Facebook: máximo 63206 caracteres, texto mais longo e descritivo é aceito, pode incluir chamada para ação, menos hashtags (1-3).',
  youtube:   'YouTube: forneça um título chamativo (máximo 100 caracteres) e descrição otimizada para SEO (200-400 palavras com palavras-chave). Sem hashtags excessivos.',
  tiktok:    'TikTok: texto curto e direto (máximo 150 caracteres), use 3-5 hashtags trending, linguagem jovem e descontraída.',
}

const TONE_HINTS = {
  motivacional:  'Tom motivacional: inspire, energize, use verbos de ação, frases de impacto.',
  profissional:  'Tom profissional: sério, confiável, dados e fatos quando possível, linguagem formal.',
  casual:        'Tom casual: amigável, descontraído, como se falasse com um amigo, pode usar gírias leves.',
  informativo:   'Tom informativo: educativo, explique conceitos, dê dicas práticas, use listas quando adequado.',
  humoristico:   'Tom humorístico: leve, divertido, pode usar trocadilhos ou referências da cultura pop, mas sem ofender.',
}

// POST /api/ai/generate
router.post('/generate', async (req, res) => {
  try {
    const { instrucao, plataformas, quantidade, tom, idioma } = req.body

    if (!instrucao || !instrucao.trim()) return res.status(400).json({ erro: 'Instrução é obrigatória' })
    if (!plataformas || !plataformas.length) return res.status(400).json({ erro: 'Selecione ao menos uma plataforma' })
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ erro: 'ANTHROPIC_API_KEY não configurada no servidor' })

    const qtd = Math.min(Math.max(parseInt(quantidade) || 3, 1), 10)
    const toneHint = TONE_HINTS[tom] || TONE_HINTS.casual
    const idiomaHint = idioma === 'en' ? 'Escreva em inglês.' : 'Escreva em português brasileiro.'
    const platHints = plataformas.map(p => PLATFORM_HINTS[p] || p).join('\n')

    // Calcula horários sugeridos distribuídos pelos próximos dias
    const agora = new Date()
    const horariosSugeridos = calcularHorarios(qtd, plataformas)

    const prompt = `Você é um especialista em marketing digital e gestão de redes sociais.

Tarefa: Crie ${qtd} post(s) para redes sociais com base na instrução abaixo.

INSTRUÇÃO DO USUÁRIO:
${instrucao.trim()}

PLATAFORMAS ALVO:
${platHints}

${toneHint}
${idiomaHint}

REGRAS IMPORTANTES:
- Cada post deve ser independente (não referencie "post anterior" ou "próxima semana")
- Varie o ângulo e abordagem entre os posts para não ficar repetitivo
- Para YouTube, sempre inclua um campo "titulo" separado do corpo
- Não invente dados, estatísticas ou citações falsas
- Não use marcação markdown no texto do post (sem **, ##, etc)

Responda APENAS com um JSON válido no formato abaixo, sem texto antes ou depois:
{
  "posts": [
    {
      "texto": "Texto completo do post",
      "titulo": "Título para YouTube (deixe vazio se não for YouTube)",
      "hashtags": ["hashtag1", "hashtag2"],
      "emoji_destaque": "🔥",
      "angulo": "Breve descrição do ângulo/abordagem deste post (1 linha)"
    }
  ]
}`

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText = message.content[0]?.text || ''

    let parsed
    try {
      // Extrai o JSON mesmo que tenha texto extra ao redor
      const match = rawText.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('sem JSON')
      parsed = JSON.parse(match[0])
    } catch {
      return res.status(500).json({ erro: 'IA retornou formato inválido. Tente novamente.' })
    }

    const posts = (parsed.posts || []).slice(0, qtd).map((p, i) => ({
      texto:          p.texto || '',
      titulo:         p.titulo || '',
      hashtags:       Array.isArray(p.hashtags) ? p.hashtags : [],
      emoji_destaque: p.emoji_destaque || '✨',
      angulo:         p.angulo || '',
      plataformas:    plataformas,
      horario:        horariosSugeridos[i] || horariosSugeridos[0],
    }))

    res.json({ posts, usage: message.usage })
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ erro: 'ANTHROPIC_API_KEY inválida' })
    if (err.status === 429) return res.status(429).json({ erro: 'Limite de requisições da IA atingido. Tente em instantes.' })
    serverError(res, err)
  }
})

// POST /api/ai/schedule — agenda todos os posts gerados de uma vez
router.post('/schedule', async (req, res) => {
  try {
    const { posts } = req.body
    if (!Array.isArray(posts) || !posts.length) return res.status(400).json({ erro: 'Nenhum post para agendar' })

    const repo = require('../repositories/postsRepository')
    const criados = []

    for (const p of posts) {
      const post = await repo.criarPost({
        text:               p.texto,
        platforms:          p.plataformas,
        scheduledAt:        new Date(p.horario),
        repeat:             'none',
        mediaPath:          null,
        mediaType:          null,
        mediaItems:         null,
        youtubeTitle:       p.titulo || null,
        youtubeVisibility:  'public',
        youtubeIsShort:     null,
        accountId:          p.accountId || null,
        userId:             req.user.id,
        status:             'scheduled',
      })
      criados.push(post)
    }

    res.status(201).json({ agendados: criados.length, posts: criados })
  } catch (err) {
    serverError(res, err)
  }
})

function calcularHorarios(qtd, plataformas) {
  // Melhores horários por plataforma (hora local do servidor, UTC)
  const melhorasHoras = {
    instagram: [9, 12, 18, 20],
    facebook:  [9, 13, 17, 19],
    youtube:   [14, 17, 20],
    tiktok:    [7, 12, 19, 21],
  }

  const plat = plataformas[0] || 'instagram'
  const horas = melhorasHoras[plat] || [9, 12, 18]

  const agora = new Date()
  const horarios = []

  for (let i = 0; i < qtd; i++) {
    const diasAFrente = Math.floor(i / horas.length) + 1
    const horaIdx = i % horas.length
    const d = new Date(agora)
    d.setDate(d.getDate() + diasAFrente)
    d.setHours(horas[horaIdx], 0, 0, 0)
    horarios.push(d.toISOString())
  }

  return horarios
}

module.exports = router
