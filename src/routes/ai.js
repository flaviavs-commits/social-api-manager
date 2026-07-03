const { Router } = require('express')
const { serverError } = require('../utils/http')
const { encrypt, decrypt } = require('../services/tokenCrypto')

const router = Router()

const PLATFORM_HINTS = {
  instagram: 'Instagram: máximo 2200 caracteres, use hashtags relevantes (5-10), emojis são bem-vindos, tom visual e engajante.',
  facebook:  'Facebook: máximo 63206 caracteres, texto mais longo e descritivo é aceito, pode incluir chamada para ação, menos hashtags (1-3).',
  youtube:   'YouTube: forneça um título chamativo (máximo 100 caracteres) e descrição otimizada para SEO (200-400 palavras com palavras-chave). Sem hashtags excessivos.',
  tiktok:    'TikTok: texto curto e direto (máximo 150 caracteres), use 3-5 hashtags trending, linguagem jovem e descontraída.',
}

const TONE_HINTS = {
  motivacional: 'Tom motivacional: inspire, energize, use verbos de ação, frases de impacto.',
  profissional: 'Tom profissional: sério, confiável, dados e fatos quando possível, linguagem formal.',
  casual:       'Tom casual: amigável, descontraído, como se falasse com um amigo, pode usar gírias leves.',
  informativo:  'Tom informativo: educativo, explique conceitos, dê dicas práticas, use listas quando adequado.',
  humoristico:  'Tom humorístico: leve, divertido, pode usar trocadilhos ou referências da cultura pop, mas sem ofender.',
}

function buildPrompt(instrucao, plataformas, qtd, tom, idioma) {
  const toneHint   = TONE_HINTS[tom] || TONE_HINTS.casual
  const idiomaHint = idioma === 'en' ? 'Escreva em inglês.' : 'Escreva em português brasileiro.'
  const platHints  = plataformas.map(p => PLATFORM_HINTS[p] || p).join('\n')

  return `Você é um especialista em marketing digital e gestão de redes sociais.

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
}

function parseJsonResponse(rawText) {
  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('sem JSON')
  return JSON.parse(match[0])
}

async function getUserApiKey(pool, userId, modelo) {
  try {
    const { rows } = await pool.query(
      `SELECT api_key FROM user_ai_keys WHERE user_id = $1 AND modelo = $2`,
      [userId, modelo]
    )
    if (!rows[0]?.api_key) return null
    return decrypt(rows[0].api_key)
  } catch { return null }
}

async function generateWithClaude(prompt, userKey) {
  const key = userKey || process.env.ANTHROPIC_API_KEY
  if (!key) throw Object.assign(new Error('Para usar o Claude, configure sua chave de API da Anthropic.'), { status: 503 })
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: key })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text || ''
}

async function generateWithOpenAI(prompt, userKey) {
  const key = userKey || process.env.OPENAI_API_KEY
  if (!key) throw Object.assign(new Error('Para usar o GPT, configure sua chave de API da OpenAI.'), { status: 503 })
  const OpenAI = require('openai')
  const client = new OpenAI({ apiKey: key })
  const msg = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.choices[0]?.message?.content || ''
}

async function generateWithGemini(prompt, userKey) {
  const key = userKey || process.env.GEMINI_API_KEY
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY não configurada no servidor'), { status: 503 })
  const { GoogleGenAI } = require('@google/genai')
  const client = new GoogleGenAI({ apiKey: key })

  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      })
      return result.text
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        if (attempt < MAX_RETRIES) {
          // Backoff exponencial: 2s, 4s
          await new Promise(r => setTimeout(r, 2000 * attempt))
          continue
        }
        throw Object.assign(new Error('quota'), { status: 429 })
      }
      if (msg.includes('401') || msg.includes('API_KEY') || msg.includes('invalid')) {
        throw Object.assign(new Error('Chave Gemini inválida'), { status: 401 })
      }
      throw e
    }
  }
}

// POST /api/ai/generate
router.post('/generate', async (req, res) => {
  try {
    const { instrucao, plataformas, quantidade, tom, idioma, modelo = 'gemini' } = req.body

    if (!instrucao || !instrucao.trim()) return res.status(400).json({ erro: 'Instrução é obrigatória' })
    if (!plataformas || !plataformas.length) return res.status(400).json({ erro: 'Selecione ao menos uma plataforma' })

    const qtd    = Math.min(Math.max(parseInt(quantidade) || 3, 1), 10)
    const prompt = buildPrompt(instrucao, plataformas, qtd, tom, idioma)
    const horariosSugeridos = calcularHorarios(qtd, plataformas)

    const userKey = await getUserApiKey(pool, req.user.id, modelo)
    let rawText
    if (modelo === 'openai')       rawText = await generateWithOpenAI(prompt, userKey)
    else if (modelo === 'claude')  rawText = await generateWithClaude(prompt, userKey)
    else                           rawText = await generateWithGemini(prompt, userKey)

    let parsed
    try {
      parsed = parseJsonResponse(rawText)
    } catch {
      return res.status(500).json({ erro: 'IA retornou formato inválido. Tente novamente.' })
    }

    const posts = (parsed.posts || []).slice(0, qtd).map((p, i) => ({
      texto:          p.texto || '',
      titulo:         p.titulo || '',
      hashtags:       Array.isArray(p.hashtags) ? p.hashtags : [],
      emoji_destaque: p.emoji_destaque || '✨',
      angulo:         p.angulo || '',
      plataformas,
      horario:        horariosSugeridos[i] || horariosSugeridos[0],
      modelo,
    }))

    res.json({ posts, modelo })
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ erro: err.message })
    if (err.status === 401) return res.status(422).json({ erro: 'Chave de API inválida. Verifique a chave configurada.' })
    if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({ erro: 'Limite de requisições da IA atingido. Aguarde alguns segundos e tente novamente.' })
    }
    console.error('[AI] Erro ao gerar:', err.message, err.status, err.constructor?.name)
    serverError(res, err)
  }
})

// ── API Keys do usuário por modelo ───────────────────────────────────────────
const pool = require('../db/pool')

// Garante que a tabela existe (cria na primeira execução)
pool.query(`
  CREATE TABLE IF NOT EXISTS user_ai_keys (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    modelo    TEXT NOT NULL,
    api_key   TEXT NOT NULL,
    criado_em TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, modelo)
  )
`).catch(() => {})

pool.query(`
  CREATE TABLE IF NOT EXISTS user_ai_prefs (
    user_id         INTEGER PRIMARY KEY,
    preferred_model TEXT NOT NULL,
    atualizado_em   TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {})

// PUT /api/ai/apikey — salva ou atualiza a API key do usuário para um modelo
router.put('/apikey', async (req, res) => {
  try {
    const { modelo, apiKey } = req.body || {}
    if (!modelo || !apiKey?.trim()) return res.status(400).json({ erro: 'modelo e apiKey são obrigatórios' })
    const encrypted = encrypt(apiKey.trim())
    await pool.query(`
      INSERT INTO user_ai_keys (user_id, modelo, api_key)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, modelo) DO UPDATE SET api_key = EXCLUDED.api_key, criado_em = NOW()
    `, [req.user.id, modelo, encrypted])
    res.json({ ok: true })
  } catch (err) { serverError(res, err) }
})

// GET /api/ai/apikey/:modelo — verifica se o usuário tem key salva para o modelo
router.get('/apikey/:modelo', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM user_ai_keys WHERE user_id = $1 AND modelo = $2`,
      [req.user.id, req.params.modelo]
    )
    res.json({ hasKey: rows.length > 0 })
  } catch (err) { serverError(res, err) }
})

// DELETE /api/ai/apikey/:modelo — remove a key do usuário para o modelo
router.delete('/apikey/:modelo', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM user_ai_keys WHERE user_id = $1 AND modelo = $2`,
      [req.user.id, req.params.modelo]
    )
    res.json({ ok: true })
  } catch (err) { serverError(res, err) }
})

// GET /api/ai/prefs — retorna modelo preferido do usuário
router.get('/prefs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT preferred_model FROM user_ai_prefs WHERE user_id = $1`,
      [req.user.id]
    )
    res.json({ preferred_model: rows[0]?.preferred_model || null })
  } catch (err) { serverError(res, err) }
})

// PUT /api/ai/prefs — salva modelo preferido do usuário
router.put('/prefs', async (req, res) => {
  try {
    const { modelo } = req.body || {}
    if (!modelo) return res.status(400).json({ erro: 'modelo é obrigatório' })
    await pool.query(`
      INSERT INTO user_ai_prefs (user_id, preferred_model)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET preferred_model = EXCLUDED.preferred_model, atualizado_em = NOW()
    `, [req.user.id, modelo])
    res.json({ ok: true })
  } catch (err) { serverError(res, err) }
})

// ── Memória persistente por usuário+modelo ────────────────────────────────────

// GET /api/ai/memory?modelo=gemini — busca memórias ativas do usuário para esse modelo
router.get('/memory', async (req, res) => {
  try {
    const modelo = req.query.modelo || 'gemini'
    const { rows } = await pool.query(`
      SELECT id, tipo, conteudo, criado_em, lembrar_em
      FROM ai_memory
      WHERE user_id = $1 AND model = $2 AND resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 30
    `, [req.user.id, modelo])
    res.json({ memories: rows })
  } catch (err) { serverError(res, err) }
})

// POST /api/ai/memory — salva uma memória manualmente
router.post('/memory', async (req, res) => {
  try {
    const { modelo = 'gemini', tipo = 'nota', conteudo, lembrarEm } = req.body
    if (!conteudo?.trim()) return res.status(400).json({ erro: 'conteudo é obrigatório' })
    const { rows } = await pool.query(`
      INSERT INTO ai_memory (user_id, model, tipo, conteudo, lembrar_em)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [req.user.id, modelo, tipo, conteudo.trim(), lembrarEm || null])
    res.status(201).json({ id: rows[0].id })
  } catch (err) { serverError(res, err) }
})

// PATCH /api/ai/memory/:id/resolve — marca memória como resolvida
router.patch('/memory/:id/resolve', async (req, res) => {
  try {
    await pool.query(
      `UPDATE ai_memory SET resolvido = TRUE WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    )
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

// DELETE /api/ai/memory/:id
router.delete('/memory/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM ai_memory WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id])
    res.status(204).send()
  } catch (err) { serverError(res, err) }
})

// POST /api/ai/memory/extract — extrai lembretes/ideias de uma conversa via IA
router.post('/memory/extract', async (req, res) => {
  try {
    const { conversa, modelo = 'gemini' } = req.body
    if (!conversa?.trim()) return res.json({ memories: [] })

    const prompt = `Analise a conversa abaixo entre um usuário e um assistente de redes sociais.
Extraia APENAS informações que o usuário claramente quer lembrar no futuro, como:
- Ideias de posts que não foram criadas ainda
- Pedidos de "postar tal coisa amanhã/na semana"
- Temas que o usuário quer explorar depois
- Preferências declaradas (tom, horário, redes preferidas)
- Qualquer coisa que o usuário disse "vou pensar" ou "deixa pra depois"

NÃO extraia posts que já foram agendados ou criados.
NÃO extraia informações genéricas ou óbvias.

Conversa:
${conversa.slice(0, 3000)}

Responda APENAS com JSON válido, sem texto extra:
{
  "memories": [
    { "tipo": "lembrete|ideia|preferencia|pendente", "conteudo": "descrição clara e objetiva em 1-2 frases", "lembrar_em": "ISO8601 ou null" }
  ]
}
Se não houver nada relevante, retorne: {"memories": []}`

    let rawText = ''
    try {
      if (modelo === 'openai')     rawText = await generateWithOpenAI(prompt)
      else if (modelo === 'claude') rawText = await generateWithClaude(prompt)
      else                          rawText = await generateWithGemini(prompt)
    } catch { return res.json({ memories: [] }) }

    let parsed
    try { parsed = parseJsonResponse(rawText) } catch { return res.json({ memories: [] }) }

    const memories = parsed.memories || []
    const saved = []
    for (const m of memories) {
      if (!m.conteudo?.trim()) continue
      const { rows } = await pool.query(`
        INSERT INTO ai_memory (user_id, model, tipo, conteudo, lembrar_em)
        VALUES ($1, $2, $3, $4, $5) RETURNING id, tipo, conteudo, lembrar_em
      `, [req.user.id, modelo, m.tipo || 'nota', m.conteudo.trim(), m.lembrar_em || null])
      saved.push(rows[0])
    }

    res.json({ memories: saved })
  } catch (err) { serverError(res, err) }
})

// Garante tabela de leads de imagem
pool.query(`
  CREATE TABLE IF NOT EXISTS ai_image_leads (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER,
    email     TEXT NOT NULL,
    descricao TEXT,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {})

// POST /api/ai/image/generate — gera imagem via Google Imagen com chave do usuário
router.post('/image/generate', async (req, res) => {
  try {
    const { descricao } = req.body || {}
    if (!descricao?.trim()) return res.status(400).json({ erro: 'Descrição é obrigatória' })

    const userKey = await getUserApiKey(pool, req.user.id, 'gemini')
    if (!userKey) return res.status(402).json({ erro: 'sem_chave' })

    const { GoogleGenAI } = require('@google/genai')
    const client = new GoogleGenAI({ apiKey: userKey })
    const result = await client.models.generateImages({
      model: 'imagen-4.0-generate-preview-05-20',
      prompt: descricao.trim(),
      config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
    })

    const imgData = result.generatedImages?.[0]?.image?.imageBytes
    if (!imgData) return res.status(500).json({ erro: 'Imagem não gerada. Tente novamente.' })

    res.json({ image: `data:image/jpeg;base64,${imgData}` })
  } catch (err) {
    console.error('[AI Image]', err.message)
    if (err.message?.includes('billing')) return res.status(402).json({ erro: 'billing' })
    if (err.message?.includes('quota') || err.message?.includes('429')) return res.status(429).json({ erro: 'Limite de geração de imagens atingido. Tente novamente mais tarde.' })
    return res.status(500).json({ erro: err.message || 'Erro ao gerar imagem.' })
  }
})

// POST /api/ai/image/lead — salva lead de usuário interessado em geração de imagem
router.post('/image/lead', async (req, res) => {
  try {
    const { email, descricao } = req.body || {}
    if (!email?.trim()) return res.status(400).json({ erro: 'E-mail é obrigatório' })
    await pool.query(
      `INSERT INTO ai_image_leads (user_id, email, descricao) VALUES ($1, $2, $3)`,
      [req.user.id, email.trim(), descricao?.trim() || null]
    )
    res.json({ ok: true })
  } catch (err) { serverError(res, err) }
})

// GET /api/ai/models — retorna quais modelos estão disponíveis (chave configurada)
router.get('/models', (req, res) => {
  res.json({
    models: [
      { id: 'gemini', name: 'Gemini 1.5 Flash', provider: 'Google', available: !!process.env.GEMINI_API_KEY },
      { id: 'openai', name: 'GPT-4o Mini',       provider: 'OpenAI', available: !!process.env.OPENAI_API_KEY },
      { id: 'claude', name: 'Claude Haiku', provider: 'Anthropic', available: !!process.env.ANTHROPIC_API_KEY },
    ]
  })
})

// POST /api/ai/schedule
router.post('/schedule', async (req, res) => {
  try {
    const { posts } = req.body
    if (!Array.isArray(posts) || !posts.length) return res.status(400).json({ erro: 'Nenhum post para agendar' })

    const repo = require('../repositories/postsRepository')
    const criados = []

    for (const p of posts) {
      const post = await repo.criarPost({
        text:              p.texto,
        platforms:         p.plataformas,
        scheduledAt:       new Date(p.horario),
        repeat:            'none',
        mediaPath:         null,
        mediaType:         null,
        mediaItems:        null,
        youtubeTitle:      p.titulo || null,
        youtubeVisibility: 'public',
        youtubeIsShort:    null,
        accountId:         p.accountId || null,
        userId:            req.user.id,
        status:            'scheduled',
      })
      criados.push(post)
    }

    res.status(201).json({ agendados: criados.length, posts: criados })
  } catch (err) {
    serverError(res, err)
  }
})

function calcularHorarios(qtd, plataformas) {
  const melhorasHoras = {
    instagram: [9, 12, 18, 20],
    facebook:  [9, 13, 17, 19],
    youtube:   [14, 17, 20],
    tiktok:    [7, 12, 19, 21],
  }
  const plat  = plataformas[0] || 'instagram'
  const horas = melhorasHoras[plat] || [9, 12, 18]
  const agora = new Date()
  const horarios = []
  for (let i = 0; i < qtd; i++) {
    const d = new Date(agora)
    d.setDate(d.getDate() + Math.floor(i / horas.length) + 1)
    d.setHours(horas[i % horas.length], 0, 0, 0)
    horarios.push(d.toISOString())
  }
  return horarios
}

module.exports = router
