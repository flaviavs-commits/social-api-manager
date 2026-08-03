const { Router } = require('express')
const { serverError, isAdminRole } = require('../utils/http')
const { encrypt, decrypt } = require('../services/tokenCrypto')
const requireSuperAdmin = require('../middleware/requireSuperAdmin')
const { ajustarPostParaPlataformas, limiteTexto, YOUTUBE_TITLE_MAX } = require('../domain/posts/platformLimits')

const router = Router()

// Dicas de ESTILO para o prompt do LLM — o "máximo 150 caracteres" do TikTok
// aqui é uma recomendação de tom (post curto costuma performar melhor), não
// o limite técnico real da API (2200 para vídeo, 90 para foto — ver
// domain/posts/platformLimits.js). O LLM pode não respeitar essas dicas à
// risca; a garantia real de que o texto cabe é aplicada depois, em
// ajustarPostParaPlataformas() dentro de montarResposta().
const PLATFORM_HINTS = {
  instagram: 'Instagram: máximo 2200 caracteres, use hashtags relevantes (5-10), emojis são bem-vindos, tom visual e engajante.',
  facebook:  'Facebook: máximo 63206 caracteres, texto mais longo e descritivo é aceito, pode incluir chamada para ação, menos hashtags (1-3).',
  youtube:   'YouTube: forneça um título chamativo (máximo 100 caracteres) e descrição otimizada para SEO (200-400 palavras com palavras-chave). Sem hashtags excessivos.',
  tiktok:    'TikTok: texto curto e direto (idealmente até 150 caracteres para melhor engajamento, limite técnico real é maior), use 3-5 hashtags trending, linguagem jovem e descontraída.',
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

const CLAUDE_MODEL_IDS = {
  'claude':        'claude-haiku-4-5-20251001',
  'claude-sonnet': 'claude-sonnet-5',
}

const OPENAI_MODEL_IDS = {
  'openai':      'gpt-4o-mini',
  'openai-4o':   'gpt-4o',
}

async function generateWithClaude(prompt, userKey, modelId = 'claude') {
  const key = userKey || process.env.ANTHROPIC_API_KEY
  if (!key) throw Object.assign(new Error('Para usar o Claude, configure sua chave de API da Anthropic.'), { status: 503 })
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: key })
  const msg = await client.messages.create({
    model: CLAUDE_MODEL_IDS[modelId] || CLAUDE_MODEL_IDS.claude,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text || ''
}

async function generateWithOpenAI(prompt, userKey, modelId = 'openai') {
  const key = userKey || process.env.OPENAI_API_KEY
  if (!key) throw Object.assign(new Error('Para usar o GPT, configure sua chave de API da OpenAI.'), { status: 503 })
  const OpenAI = require('openai')
  const client = new OpenAI({ apiKey: key })
  const msg = await client.chat.completions.create({
    model: OPENAI_MODEL_IDS[modelId] || OPENAI_MODEL_IDS.openai,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.choices[0]?.message?.content || ''
}

// OpenRouter fala o mesmo formato de API que a OpenAI (chat.completions) — só
// muda a baseURL e o formato do id do modelo ("empresa/modelo"). Um único
// modelo fixo (gpt-4o-mini via OpenRouter) evita ter que expor ao usuário a
// escolha entre dezenas de modelos disponíveis no OpenRouter.
const OPENROUTER_MODEL_IDS = {
  openrouter: 'openai/gpt-oss-20b:free',
}

async function generateWithOpenRouter(prompt, userKey, modelId = 'openrouter') {
  const key = userKey || process.env.OPENROUTER_API_KEY
  if (!key) throw Object.assign(new Error('Para usar o OpenRouter, configure sua chave de API.'), { status: 503 })
  const OpenAI = require('openai')
  const client = new OpenAI({ apiKey: key, baseURL: 'https://openrouter.ai/api/v1' })
  const msg = await client.chat.completions.create({
    model: OPENROUTER_MODEL_IDS[modelId] || OPENROUTER_MODEL_IDS.openrouter,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.choices[0]?.message?.content || ''
}

// O modelo gratuito padrão do OpenRouter (gpt-oss-20b:free) não suporta
// imagem — usamos um modelo de visão barato do próprio OpenRouter só para
// análise de mídia, mantendo a mesma chave/conta do usuário.
const OPENROUTER_VISION_MODEL = 'google/gemini-2.5-flash-lite'

// "Nano Banana 2 Lite" — modelo multimodal do OpenRouter que gera TEXTO e
// IMAGEM na mesma resposta (modalities: ["image","text"]), diferente do
// Imagen do Google (só imagem, endpoint separado generateImages). Usado no
// modelo "openrouter-image" do Agente IA — sempre exige chave própria do
// usuário no OpenRouter, mesmo padrão já usado para o Imagen/Gemini.
const OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-lite-image'

// Analisa uma imagem/vídeo respeitando o modelo escolhido pelo usuário no
// seletor — cada provedor recebe a mídia no formato nativo do seu SDK.
// Vídeo (sem mediaBase64) não tem suporte a mídia nativa em nenhum provedor
// aqui; o prompt já avisa isso e pede sugestão baseada só no contexto.
async function analisarMidiaComModelo({ modelo, prompt, mediaBase64, mimeType, userKey, isVideo }) {
  if (isVideo) {
    const promptVideo = `${prompt}\n\n(Nota: o usuário enviou um vídeo. Crie sugestões com base no contexto disponível.)`
    if (OPENAI_MODEL_IDS[modelo])          return generateWithOpenAI(promptVideo, userKey, modelo)
    if (OPENROUTER_MODEL_IDS[modelo])      return generateWithOpenRouter(promptVideo, userKey, modelo)
    if (CLAUDE_MODEL_IDS[modelo])          return generateWithClaude(promptVideo, userKey, modelo)
    return generateWithGemini(promptVideo, userKey, modelo)
  }

  if (OPENAI_MODEL_IDS[modelo]) {
    const key = userKey || process.env.OPENAI_API_KEY
    if (!key) throw Object.assign(new Error('Para usar o GPT, configure sua chave de API da OpenAI.'), { status: 503 })
    const OpenAI = require('openai')
    const client = new OpenAI({ apiKey: key })
    const msg = await client.chat.completions.create({
      model: OPENAI_MODEL_IDS[modelo],
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${mediaBase64}` } },
        ],
      }],
    })
    return msg.choices[0]?.message?.content || ''
  }

  if (OPENROUTER_MODEL_IDS[modelo]) {
    const key = userKey || process.env.OPENROUTER_API_KEY
    if (!key) throw Object.assign(new Error('Para usar o OpenRouter, configure sua chave de API.'), { status: 503 })
    const OpenAI = require('openai')
    const client = new OpenAI({ apiKey: key, baseURL: 'https://openrouter.ai/api/v1' })
    const msg = await client.chat.completions.create({
      model: OPENROUTER_VISION_MODEL,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${mediaBase64}` } },
        ],
      }],
    })
    return msg.choices[0]?.message?.content || ''
  }

  if (CLAUDE_MODEL_IDS[modelo]) {
    const key = userKey || process.env.ANTHROPIC_API_KEY
    if (!key) throw Object.assign(new Error('Para usar o Claude, configure sua chave de API da Anthropic.'), { status: 503 })
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: key })
    const msg = await client.messages.create({
      model: CLAUDE_MODEL_IDS[modelo],
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: mediaBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    })
    return msg.content[0]?.text || ''
  }

  // Gemini (padrão) — cobre 'gemini*' e qualquer modelo desconhecido, igual
  // ao comportamento original desta rota.
  const key = userKey || process.env.GEMINI_API_KEY
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY não configurada no servidor'), { status: 503 })
  const { GoogleGenAI } = require('@google/genai')
  const savedGoogleKey = process.env.GOOGLE_API_KEY
  if (userKey) delete process.env.GOOGLE_API_KEY
  const client = new GoogleGenAI({ apiKey: key })
  if (userKey && savedGoogleKey) process.env.GOOGLE_API_KEY = savedGoogleKey
  const geminiModel = GEMINI_MODEL_IDS[modelo] || 'gemini-2.0-flash'
  const result = await client.models.generateContent({
    model: geminiModel,
    contents: [
      { inlineData: { mimeType, data: mediaBase64 } },
      { text: prompt },
    ],
  })
  return result.text
}

const GEMINI_MODEL_IDS = {
  'gemini':            'gemini-2.0-flash',
  'gemini-2.5-flash':  'gemini-2.5-flash',
  'gemini-2.5-pro':    'gemini-2.5-pro',
  'gemini-2.5-lite':   'gemini-2.5-flash-lite',
}

async function generateWithGemini(prompt, userKey, modelId = 'gemini') {
  const key = userKey || process.env.GEMINI_API_KEY
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY não configurada no servidor'), { status: 503 })
  const { GoogleGenAI } = require('@google/genai')
  const savedGoogleKey = process.env.GOOGLE_API_KEY
  if (userKey) delete process.env.GOOGLE_API_KEY
  const client = new GoogleGenAI({ apiKey: key })
  if (userKey && savedGoogleKey) process.env.GOOGLE_API_KEY = savedGoogleKey

  const geminiModel = GEMINI_MODEL_IDS[modelId] || 'gemini-2.0-flash'

  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await client.models.generateContent({
        model: geminiModel,
        contents: prompt,
      })
      return result.text
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        if (attempt < MAX_RETRIES) {
          // Backoff: 1s, 2s — mantém dentro do timeout do Railway (30s)
          await new Promise(r => setTimeout(r, 1000 * attempt))
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

// ── Gerador local (sem IA / sem chave) ───────────────────────────────────────
// Monta o texto do post a partir da instrução do usuário usando templates por
// tom, sem chamar nenhuma API externa. Sempre disponível — é o modo padrão
// quando o usuário não tem chave de IA configurada. Não é tão criativo quanto
// um LLM, mas produz posts prontos e válidos para todas as redes.
const LOCAL_ABERTURAS = {
  motivacional: ['🔥 Chegou a hora de dar o próximo passo!', '💪 Nada te impede hoje.', '⚡ Sua melhor versão começa agora.', '🚀 Bora fazer acontecer!', '🌟 O único limite é o que você acredita.', '👊 Disciplina hoje, orgulho amanhã.', '🎯 Foco no que realmente importa.', '💥 Pare de esperar o momento perfeito.'],
  profissional: ['Uma abordagem estratégica faz toda a diferença.', 'Entenda como isto pode transformar o seu resultado.', 'Compartilhamos hoje uma reflexão importante.', 'Resultados consistentes vêm de decisões bem feitas.', 'No mercado de hoje, quem se antecipa sai na frente.', 'A diferença entre o bom e o excelente está nos detalhes.', 'Dados mostram: quem investe nisso colhe resultados.', 'Profissionalismo também é saber a hora de evoluir.'],
  casual:       ['Ei! 😊 Bora falar sobre uma coisa boa?', 'Passa aqui rapidinho que tenho novidade!', 'Sabe aquela dica que faz diferença? É essa. 👇', 'Chega mais que hoje o papo é bom!', 'Preciso te contar uma coisa 👀', 'Isso aqui mudou meu dia, sério.', 'Se liga nessa, você vai gostar 😌', 'Anota essa que vale ouro! ✨'],
  informativo:  ['Você sabia disso?', 'Aqui vai uma dica prática pra você.', 'Vamos direto ao ponto:', 'Entenda em poucas linhas:', 'A ciência já explicou isso 👇', 'Muita gente erra nisso — e é simples de resolver.', '3 pontos que ninguém te conta:', 'O que você precisa saber antes de começar:'],
  humoristico:  ['Confesse: já passou por isso 😂', 'Ninguém avisou, mas eu aviso! 😅', 'Spoiler: você vai rir e concordar.', 'Modo verdade ativado 👇', 'A vida real não avisa, ela acontece 🤡', 'Prometo que não é indireta (é sim) 😏', 'Você lendo isso: "sou eu literalmente" 😆', 'Quem nunca? (todo mundo já) 🙃'],
}

const LOCAL_FECHAMENTOS = {
  motivacional: ['Comenta aqui o que você vai começar hoje! 💬', 'Salva este post pra lembrar depois. 📌', 'Marca alguém que precisa ver isso! 👇', 'Compartilhe se isso te tocou. 🙌', 'Bora juntos? Deixa seu ✋ nos comentários.'],
  profissional: ['Fale com a gente para saber mais.', 'Deixe seu comentário com a sua opinião.', 'Salve este conteúdo para consultar depois.', 'Compartilhe com quem toma decisões no seu time.', 'Quer se aprofundar? Estamos à disposição.'],
  casual:       ['Conta pra mim nos comentários! 💬', 'Curtiu? Compartilha com a galera! 🙌', 'Salva aí pra não esquecer 😉', 'Marca aquele amigo pra ver também 👇', 'Me conta se você concorda! 😄'],
  informativo:  ['Salve este post para consultar depois. 📌', 'Ficou com dúvida? Comenta aqui. 💬', 'Compartilhe com quem precisa saber disso.', 'Segue o perfil pra mais conteúdo assim. 🔔', 'Qual dica te surpreendeu mais? Comenta 👇'],
  humoristico:  ['Marca aquele amigo que é assim 😂', 'Comenta um "eu" se já passou por isso! 👇', 'Salva pra rir de novo depois 😅', 'Compartilha com quem vai se identificar 🤣', 'Reage com 😂 se foi você.'],
}

const LOCAL_HASHTAGS = {
  motivacional: ['foco', 'motivacao', 'disciplina', 'metas', 'mindset', 'evolucao', 'proposito'],
  profissional: ['negocios', 'produtividade', 'estrategia', 'carreira', 'gestao', 'lideranca', 'resultados'],
  casual:       ['dicas', 'diadia', 'vida', 'bomdia', 'conteudo', 'rotina', 'inspiracao'],
  informativo:  ['voceSabia', 'dicas', 'aprenda', 'informacao', 'curiosidades', 'passoAPasso', 'saibaMais'],
  humoristico:  ['humor', 'meme', 'risada', 'relatable', 'segundafeira', 'humordodia', 'rindo'],
}

const LOCAL_EMOJIS = { motivacional: '🔥', profissional: '💼', casual: '😊', informativo: '📚', humoristico: '😂' }

// Nichos reconhecidos por palavras-chave no tema — cada um traz ganchos e
// hashtags específicos, deixando o post mais alinhado ao assunto do usuário.
const LOCAL_NICHOS = [
  { id: 'fitness',      re: /\b(treino|academia|muscula|fitness|gym|dieta|emagrec|corrida|crossfit|hipertrof|shape|malha)/i,
    hashtags: ['fitness', 'treino', 'saude', 'vidasaudavel'], gancho: 'Consistência vale mais que intensidade.' },
  { id: 'gastronomia',  re: /\b(receita|comida|cozinh|gastro|restaurante|prato|café|cafe|bebida|doce|confeita|hamburg|pizza|delivery)/i,
    hashtags: ['gastronomia', 'receita', 'comida', 'foodlover'], gancho: 'Sabor de verdade começa nos detalhes.' },
  { id: 'beleza',       re: /\b(beleza|maquiagem|skincare|cabelo|estética|estetica|unha|salão|salao|cosmétic|cosmetic|pele)/i,
    hashtags: ['beleza', 'skincare', 'autocuidado', 'makeup'], gancho: 'Autocuidado não é luxo, é rotina.' },
  { id: 'tecnologia',   re: /\b(tecnolog|software|app|aplicativo|programaç|program|dev|startup|ia\b|intelig[êe]ncia|digital|site|sistema)/i,
    hashtags: ['tecnologia', 'inovacao', 'digital', 'tech'], gancho: 'A tecnologia certa economiza o seu tempo.' },
  { id: 'moda',         re: /\b(moda|roupa|look|estilo|tend[êe]ncia|acess[óo]rio|fashion|coleç|colec|outfit)/i,
    hashtags: ['moda', 'estilo', 'look', 'tendencia'], gancho: 'Seu estilo conta a sua história.' },
  { id: 'educacao',     re: /\b(curso|aula|estud|educaç|educac|aprend|ensino|professor|escola|faculdade|vestibular|concurso|idioma|ingl[êe]s)/i,
    hashtags: ['educacao', 'aprendizado', 'estudos', 'conhecimento'], gancho: 'Conhecimento é o único investimento que ninguém tira de você.' },
  { id: 'financas',     re: /\b(dinheiro|finan[çc]|investi|economia|renda|poupar|cripto|a[çc][õo]es|bolsa|or[çc]amento|lucro|venda)/i,
    hashtags: ['financas', 'investimentos', 'dinheiro', 'educacaofinanceira'], gancho: 'Quem controla o dinheiro controla o futuro.' },
  { id: 'viagem',       re: /\b(viag|viaj|turismo|destino|hotel|praia|roteiro|passeio|mochil|passagem)/i,
    hashtags: ['viagem', 'turismo', 'destino', 'wanderlust'], gancho: 'A melhor bagagem é a experiência.' },
  { id: 'pet',          re: /\b(pet|cachorro|gato|animal|animais|ração|racao|veterin|adoç|adoc)/i,
    hashtags: ['pet', 'petlover', 'cachorro', 'gato'], gancho: 'Eles dão amor sem pedir nada em troca.' },
  { id: 'imoveis',      re: /\b(im[óo]vel|imoveis|apartamento|casa|aluguel|corretor|constru|reforma|arquitet|decoraç|decorac)/i,
    hashtags: ['imoveis', 'decoracao', 'arquitetura', 'lar'], gancho: 'Um bom espaço muda a forma como você vive.' },
]

function detectarNicho(tema) {
  return LOCAL_NICHOS.find(n => n.re.test(tema)) || null
}

// Extrai palavras-chave simples da instrução para virar hashtags temáticas
function extrairHashtagsDoTema(instrucao) {
  const stop = new Set(['sobre','para','com','que','uma','umas','uns','dos','das','como','mais','você','voce','seus','suas','post','posts','rede','redes','social','sociais','fazer','criar','quero','preciso','tema','fale','falar','sendo','muito','pouco','bem','tudo','nosso','nossa','nossos','nossas','novo','nova','meu','minha','este','esta','esse','essa','pelo','pela','entre','tipo'])
  return (instrucao.toLowerCase().match(/[a-záàâãéêíóôõúç]{4,}/gi) || [])
    .map(w => w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, ''))
    .filter(w => w.length >= 4 && !stop.has(w))
    .slice(0, 3)
}

function pick(arr, i) { return arr[i % arr.length] }
function capitalizar(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

// Cada ângulo monta o miolo do post de um jeito estruturalmente diferente, para
// que os posts variem de verdade entre si — não só na frase de abertura.
// Recebe (tema, gancho do nicho) e devolve o corpo central (sem abertura/CTA).
// São 7 ângulos (número primo em relação ao tamanho das listas de aberturas/
// fechamentos) para que a combinação abertura+ângulo+fechamento só volte a se
// repetir depois de muitos posts, mesmo em pedidos grandes (ex: 7 ou 10 posts).
const LOCAL_ANGULOS = [
  { nome: 'direto',      build: (tema) => `${capitalizar(tema)}.` },
  { nome: 'pergunta',    build: (tema) => `Você já parou pra pensar em ${tema}?\n\nÉ mais simples do que parece — e faz toda a diferença no resultado.` },
  { nome: 'dica',        build: (tema) => `Dica de ouro sobre ${tema}:\n\nComece pequeno, seja constante e ajuste no caminho. O progresso vem de quem não desiste.` },
  { nome: 'lista',       build: (tema) => `3 motivos pra levar ${tema} a sério:\n\n1️⃣ Traz resultado real\n2️⃣ Todo mundo consegue começar\n3️⃣ Você se sente melhor no processo` },
  { nome: 'beneficio',   build: (tema) => `${capitalizar(tema)} não é só mais uma tarefa — é o que separa quem fala de quem faz. Os detalhes de hoje são os resultados de amanhã.` },
  { nome: 'historia',    build: (tema) => `Quando o assunto é ${tema}, muita gente trava no começo. A virada acontece quando você para de planejar e começa a agir.` },
  { nome: 'erro_comum',  build: (tema) => `O erro mais comum sobre ${tema}? Achar que precisa ser perfeito desde o início.\n\nComece do jeito que der — o ajuste vem com a prática.` },
]

// Monta a descrição de vídeo do YouTube com uma estrutura mais rica (intro,
// tópicos e CTA), aproveitando melhor o espaço da plataforma.
function descricaoYoutube(tema, gancho, hashtagsArr) {
  const tags = hashtagsArr.map(h => `#${h}`).join(' ')
  return [
    `Neste vídeo falamos sobre ${tema}.`,
    gancho ? `\n${gancho}` : '',
    `\n\n📌 O que você vai ver:`,
    `\n• Como começar do jeito certo`,
    `\n• Os erros mais comuns (e como evitar)`,
    `\n• Dicas práticas pra aplicar hoje`,
    `\n\n👍 Curtiu? Deixe o like e se inscreva no canal!`,
    `\n\n${tags}`,
  ].join('')
}

function gerarPostsLocal(instrucao, plataformas, qtd, tom) {
  const t = LOCAL_ABERTURAS[tom] ? tom : 'casual'
  const tema = instrucao.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
  const temaLower = tema.toLowerCase()
  const nicho = detectarNicho(tema)

  const temaHashtags = extrairHashtagsDoTema(instrucao)
  const nichoHashtags = nicho ? nicho.hashtags : []
  const ehYoutube = plataformas.includes('youtube')
  const ehInstagram = plataformas.includes('instagram')
  // TikTok exige texto curto — se estiver entre as redes, encurta o corpo.
  const curto = plataformas.includes('tiktok')

  // Pontos de partida aleatórios nos ciclos de abertura/fechamento/ângulo: sem
  // isso, duas gerações sobre o mesmo tom sempre começavam pela mesma frase —
  // "regerar" parecia travado no template. Com offsets, cada geração começa
  // num ponto diferente do ciclo, ainda garantindo que os posts DENTRO de uma
  // mesma geração continuem variando entre si (o índice i soma ao offset).
  const aberturaOffset   = Math.floor(Math.random() * LOCAL_ABERTURAS[t].length)
  const fechamentoOffset = Math.floor(Math.random() * LOCAL_FECHAMENTOS[t].length)
  const anguloOffset     = Math.floor(Math.random() * LOCAL_ANGULOS.length)

  const posts = []
  for (let i = 0; i < qtd; i++) {
    const abertura   = pick(LOCAL_ABERTURAS[t], i + aberturaOffset)
    const fechamento = pick(LOCAL_FECHAMENTOS[t], i + fechamentoOffset)
    // Cada post usa um ângulo diferente (rotaciona pela lista, com offset
    // aleatório por geração), garantindo variação estrutural real entre eles.
    const angulo     = pick(LOCAL_ANGULOS, i + anguloOffset)
    const miolo      = angulo.build(temaLower)
    // O gancho do nicho entra a partir do 2º post pra não repetir sempre.
    const ganchoNicho = nicho && i % 2 === 1 ? `\n\n💡 ${nicho.gancho}` : ''

    let corpo
    if (curto) {
      // TikTok: abertura + tema, sem CTA nem ângulo longo (limite ~150 chars).
      corpo = `${abertura}\n\n${capitalizar(temaLower)}.`
    } else {
      corpo = `${abertura}\n\n${miolo}${ganchoNicho}\n\n${fechamento}`
    }

    // Instagram aproveita mais hashtags; TikTok fica enxuto.
    const maxTags = curto ? 4 : (ehInstagram ? 8 : 6)
    const hashtags = [...new Set([...temaHashtags, ...nichoHashtags, ...LOCAL_HASHTAGS[t]])].slice(0, maxTags)

    const titulo = ehYoutube
      ? capitalizar(temaLower).slice(0, 100)
      : ''
    // Para YouTube, o corpo vira uma descrição rica em vez do texto curto de post.
    const texto = ehYoutube && !ehInstagram && !curto && !plataformas.includes('facebook')
      ? descricaoYoutube(temaLower, nicho?.gancho, hashtags)
      : corpo

    posts.push({
      texto,
      titulo,
      hashtags,
      emoji_destaque: LOCAL_EMOJIS[t] || '✨',
      angulo: `${capitalizar(angulo.nome)}${nicho ? ` · nicho ${nicho.id}` : ''} (tom ${t})`,
    })
  }
  return { posts }
}

// ── Requisitos de mídia por plataforma ───────────────────────────────────────
// Fonte da verdade para o que cada rede exige na hora de publicar. Espelha as
// validações feitas em services/publisher.js. Usado tanto pelo endpoint
// /requirements (frontend) quanto pela checagem antes de agendar.
const PLATFORM_REQUIREMENTS = {
  instagram: { media: 'required', mediaTypes: ['image', 'video'], label: 'Instagram', descricao: 'Exige uma imagem ou vídeo — não publica só texto.' },
  facebook:  { media: 'optional', mediaTypes: ['image', 'video'], label: 'Facebook',  descricao: 'Aceita só texto; imagem/vídeo são opcionais.' },
  youtube:   { media: 'required', mediaTypes: ['video'],          label: 'YouTube',   descricao: 'Exige um vídeo e um título.' },
  tiktok:    { media: 'required', mediaTypes: ['image', 'video'], label: 'TikTok',    descricao: 'Exige ao menos uma mídia (imagem ou vídeo) e texto curto.' },
}

// GET /api/ai/requirements?plataformas=instagram,youtube — o que cada rede exige
router.get('/requirements', (req, res) => {
  const plataformas = String(req.query.plataformas || '').split(',').map(p => p.trim()).filter(Boolean)
  const lista = (plataformas.length ? plataformas : Object.keys(PLATFORM_REQUIREMENTS))
    .filter(p => PLATFORM_REQUIREMENTS[p])
    .map(p => ({
      plataforma: p,
      ...PLATFORM_REQUIREMENTS[p],
      textMax: limiteTexto(p, 'video'),
      ...(p === 'tiktok' ? { textMaxPhoto: limiteTexto(p, 'image') } : {}),
      ...(p === 'youtube' ? { titleMax: YOUTUBE_TITLE_MAX } : {}),
    }))
  res.json({ requirements: lista })
})

// ── Demo grátis do LLM (modelo "local") ──────────────────────────────────────
// O modelo "local" usa o Gemini com a CHAVE DO SERVIDOR — o usuário testa um LLM
// real sem precisar de conta/chave própria, antes de assinar. Para não estourar
// o custo da chave do dono, cada usuário tem um limite diário de gerações via
// demo; ao atingir, cai no gerador por template (que é ilimitado e sem custo).
const DEMO_LIMITE_DIA = parseInt(process.env.AI_DEMO_LIMITE_DIA || '', 10) || 10
// A tabela ai_demo_usage é criada mais abaixo, junto das demais (depois que
// `pool` é definido) — não pode ser criada aqui pois `pool` ainda está na TDZ.

// Retorna quantos usos o usuário já fez hoje no demo (0 se nunca usou).
async function demoUsosHoje(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT usos FROM ai_demo_usage WHERE user_id = $1 AND dia = CURRENT_DATE`,
      [userId]
    )
    return rows[0]?.usos || 0
  } catch { return 0 }
}

// Incrementa o contador de uso do demo do usuário para hoje.
async function registrarUsoDemo(userId) {
  try {
    await pool.query(`
      INSERT INTO ai_demo_usage (user_id, dia, usos)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (user_id, dia) DO UPDATE SET usos = ai_demo_usage.usos + 1
    `, [userId])
  } catch { /* contagem best-effort: falha aqui não deve bloquear a geração */ }
}

// GET /api/ai/demo-status — quanto resta do demo grátis hoje (para o frontend)
router.get('/demo-status', async (req, res) => {
  const hasServerKey = !!process.env.GEMINI_API_KEY
  const usados = await demoUsosHoje(req.user.id)
  res.json({
    llmDisponivel: hasServerKey,
    limite: DEMO_LIMITE_DIA,
    usados,
    restantes: Math.max(0, DEMO_LIMITE_DIA - usados),
  })
})

// POST /api/ai/generate
router.post('/generate', async (req, res) => {
  try {
    const { instrucao, plataformas, quantidade, tom, idioma, modelo = 'gemini' } = req.body

    if (!instrucao || !instrucao.trim()) return res.status(400).json({ erro: 'Instrução é obrigatória' })
    if (!plataformas || !plataformas.length) return res.status(400).json({ erro: 'Selecione ao menos uma plataforma' })

    const qtd    = Math.min(Math.max(parseInt(quantidade) || 3, 1), 10)
    const horariosSugeridos = calcularHorarios(qtd, plataformas)

    // Monta a resposta padronizada a partir de posts já parseados. Também
    // registra a atividade (sucesso ou fallback) no histórico do Agente IA.
    //
    // Ajusta cada post aos limites reais de caracteres das plataformas
    // selecionadas (ver domain/posts/platformLimits.js) — o LLM recebe uma
    // dica desses limites no prompt (PLATFORM_HINTS), mas nada garante que
    // ele respeite de fato, então o corte aqui é a garantia real. Mídia
    // ainda não foi anexada nesta etapa (isso só acontece no /schedule), por
    // isso usa o limite de vídeo do TikTok (mais permissivo) — o limite mais
    // restrito de foto (90 chars) é aplicado de novo na hora de publicar.
    const montarResposta = (postsRaw, modeloUsado, extra = {}) => {
      const avisosGerais = new Set()
      const posts = postsRaw.slice(0, qtd).map((p, i) => {
        const { post: ajustado, avisos } = ajustarPostParaPlataformas(
          { texto: p.texto || '', titulo: p.titulo || '' },
          plataformas,
          null
        )
        avisos.forEach(a => avisosGerais.add(a))
        return {
          texto:          ajustado.texto,
          titulo:         ajustado.titulo,
          hashtags:       Array.isArray(p.hashtags) ? p.hashtags : [],
          emoji_destaque: p.emoji_destaque || '✨',
          angulo:         p.angulo || '',
          plataformas,
          horario:        horariosSugeridos[i] || horariosSugeridos[0],
          modelo:         modeloUsado,
        }
      })
      registrarAtividadeIA({
        userId: req.user.id,
        acao: 'generate',
        status: extra.fallback ? 'fallback' : 'sucesso',
        modelo: modeloUsado,
        detalhes: `${posts.length} post(s) · plataformas: ${plataformas.join(',')}${extra.fallback ? ` · fallback: ${extra.fallback}` : ''}`,
      })
      const avisos = Array.from(avisosGerais)
      return res.json({ modelo: modeloUsado, ...extra, posts, ...(avisos.length ? { avisos } : {}) })
    }

    // Cai no gerador por template (ilimitado, sem custo). Usado como fallback
    // do demo quando não há LLM disponível ou o limite diário foi atingido.
    const responderComTemplate = (motivo = null) => {
      const parsedLocal = gerarPostsLocal(instrucao, plataformas, qtd, tom)
      return montarResposta(parsedLocal.posts, 'local', motivo ? { fallback: motivo } : {})
    }

    // Modo demo (modelo "local"): tenta o LLM real (Gemini) com a CHAVE DO
    // SERVIDOR, sem exigir conta do usuário — respeitando o limite diário.
    // Sem chave no servidor OU limite estourado OU erro do LLM → template.
    if (modelo === 'local') {
      if (!process.env.GEMINI_API_KEY) return responderComTemplate()

      const usados = await demoUsosHoje(req.user.id)
      if (usados >= DEMO_LIMITE_DIA) return responderComTemplate('limite_diario')

      try {
        const promptDemo = buildPrompt(instrucao, plataformas, qtd, tom, idioma)
        // userKey = null → generateWithGemini usa process.env.GEMINI_API_KEY
        const rawTextDemo = await generateWithGemini(promptDemo, null, 'gemini')
        const parsedDemo = parseJsonResponse(rawTextDemo)
        await registrarUsoDemo(req.user.id)
        return montarResposta(parsedDemo.posts || [], 'local', { llm: true, restantes: Math.max(0, DEMO_LIMITE_DIA - usados - 1) })
      } catch (e) {
        // Qualquer falha do LLM (quota, formato inválido, rede) → template,
        // para o usuário nunca ficar sem resposta no modo grátis.
        console.error('[AI demo] LLM falhou, usando template:', e.message)
        return responderComTemplate('llm_indisponivel')
      }
    }

    const prompt = buildPrompt(instrucao, plataformas, qtd, tom, idioma)

    // Um usuário comum não sabe gerar uma API key do Google AI Studio (é uma
    // credencial técnica, exige projeto no Cloud, às vezes billing) — por isso
    // TODOS os modelos Gemini (incluindo 2.5 Pro/Flash/Lite) usam a CHAVE DO
    // SERVIDOR sempre, com o mesmo limite diário do modo "local". Só OpenAI e
    // Claude continuam exigindo chave própria do usuário (não há chave deles
    // configurada no servidor).
    if (GEMINI_MODEL_IDS[modelo]) {
      if (!process.env.GEMINI_API_KEY) {
        throw Object.assign(new Error('Nenhum modelo Gemini está disponível no momento.'), { status: 503 })
      }
      const usados = await demoUsosHoje(req.user.id)
      // Diferente do modelo "local" (modo grátis/padrão, onde cair no
      // template é o comportamento esperado): aqui o usuário escolheu um
      // modelo Gemini específico de propósito — trocar silenciosamente pelo
      // template dava um texto genérico sem avisar direito que a IA de
      // verdade não rodou. Agora vira um erro explícito no limite.
      if (usados >= DEMO_LIMITE_DIA) {
        throw Object.assign(new Error(`Limite diário de gerações com IA (${DEMO_LIMITE_DIA}) atingido. Tente novamente amanhã ou use sua própria chave de API para gerar sem limite.`), { status: 429 })
      }

      const rawTextGemini = await generateWithGemini(prompt, null, modelo)
      await registrarUsoDemo(req.user.id)
      let parsedGemini
      try {
        parsedGemini = parseJsonResponse(rawTextGemini)
      } catch {
        return res.status(500).json({ erro: 'IA retornou formato inválido. Tente novamente.' })
      }
      return montarResposta(parsedGemini.posts || [], modelo, { llm: true, restantes: Math.max(0, DEMO_LIMITE_DIA - usados - 1) })
    }

    const userKey = await getUserApiKey(pool, req.user.id, modelo)

    // OpenAI (GPT-4o Mini/GPT-4o) roda com a chave do servidor quando o
    // usuário não tem chave própria salva — mesmo padrão de custo controlado
    // já usado pelo Gemini, com o mesmo limite diário compartilhado. Claude
    // continua exigindo chave própria do usuário (sem ANTHROPIC_API_KEY no
    // servidor); sem chave própria, generateWithClaude já lança erro 503
    // claro pedindo pra configurar.
    if (OPENAI_MODEL_IDS[modelo] && !userKey) {
      if (!process.env.OPENAI_API_KEY) {
        throw Object.assign(new Error('Para usar o GPT sem sua própria chave, configure a chave de API da OpenAI no servidor.'), { status: 503 })
      }
      const usados = await demoUsosHoje(req.user.id)
      if (usados >= DEMO_LIMITE_DIA) {
        throw Object.assign(new Error(`Limite diário de gerações com IA (${DEMO_LIMITE_DIA}) atingido. Tente novamente amanhã ou use sua própria chave de API para gerar sem limite.`), { status: 429 })
      }
      const rawTextOpenai = await generateWithOpenAI(prompt, null, modelo)
      await registrarUsoDemo(req.user.id)
      let parsedOpenai
      try {
        parsedOpenai = parseJsonResponse(rawTextOpenai)
      } catch {
        return res.status(500).json({ erro: 'IA retornou formato inválido. Tente novamente.' })
      }
      return montarResposta(parsedOpenai.posts || [], modelo, { llm: true, restantes: Math.max(0, DEMO_LIMITE_DIA - usados - 1) })
    }

    // OpenRouter segue o mesmo padrão do OpenAI: roda com a chave do servidor
    // (mesmo limite diário compartilhado) quando o usuário não tem chave
    // própria salva.
    if (OPENROUTER_MODEL_IDS[modelo] && !userKey) {
      if (!process.env.OPENROUTER_API_KEY) {
        throw Object.assign(new Error('Para usar o OpenRouter sem sua própria chave, configure a chave de API no servidor.'), { status: 503 })
      }
      const usados = await demoUsosHoje(req.user.id)
      if (usados >= DEMO_LIMITE_DIA) {
        throw Object.assign(new Error(`Limite diário de gerações com IA (${DEMO_LIMITE_DIA}) atingido. Tente novamente amanhã ou use sua própria chave de API para gerar sem limite.`), { status: 429 })
      }
      const rawTextOpenrouter = await generateWithOpenRouter(prompt, null, modelo)
      await registrarUsoDemo(req.user.id)
      let parsedOpenrouter
      try {
        parsedOpenrouter = parseJsonResponse(rawTextOpenrouter)
      } catch {
        return res.status(500).json({ erro: 'IA retornou formato inválido. Tente novamente.' })
      }
      return montarResposta(parsedOpenrouter.posts || [], modelo, { llm: true, restantes: Math.max(0, DEMO_LIMITE_DIA - usados - 1) })
    }

    let rawText
    if (OPENAI_MODEL_IDS[modelo])       rawText = await generateWithOpenAI(prompt, userKey, modelo)
    else if (OPENROUTER_MODEL_IDS[modelo]) rawText = await generateWithOpenRouter(prompt, userKey, modelo)
    else if (CLAUDE_MODEL_IDS[modelo])  rawText = await generateWithClaude(prompt, userKey, modelo)
    else                                 rawText = await generateWithGemini(prompt, userKey, modelo)

    let parsed
    try {
      parsed = parseJsonResponse(rawText)
    } catch {
      return res.status(500).json({ erro: 'IA retornou formato inválido. Tente novamente.' })
    }

    return montarResposta(parsed.posts || [], modelo)
  } catch (err) {
    const modeloTentado = req.body?.modelo || 'gemini'
    registrarAtividadeIA({ userId: req.user.id, acao: 'generate', status: 'erro', modelo: modeloTentado, detalhes: err.message })

    if (err.status === 503) return res.status(503).json({ erro: err.message })
    if (err.status === 401) return res.status(422).json({ erro: 'Chave de API inválida. Verifique a chave configurada.' })
    // O SDK do Gemini lança status 429 com a mensagem curta e genérica
    // "quota" para rate-limit momentâneo (segundos/minutos) — cai no fallback
    // padrão abaixo. Mensagens 429 mais longas são erros customizados nossos
    // (ex: limite diário do demo, que só reseta amanhã) e preservam o texto
    // original, que já é claro sobre o que aconteceu e o que fazer.
    if (err.status === 429 && err.message !== 'quota') return res.status(429).json({ erro: err.message })
    if (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('RESOURCE_EXHAUSTED')) {
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
    last_four TEXT,
    status    TEXT NOT NULL DEFAULT 'valid',
    criado_em TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, modelo)
  )
`).then(() => pool.query(`
  ALTER TABLE user_ai_keys ADD COLUMN IF NOT EXISTS last_four TEXT
`)).then(() => pool.query(`
  ALTER TABLE user_ai_keys ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'valid'
`)).catch(() => {})

pool.query(`
  CREATE TABLE IF NOT EXISTS user_ai_prefs (
    user_id         INTEGER PRIMARY KEY,
    preferred_model TEXT NOT NULL,
    atualizado_em   TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {})

// Contagem de uso do demo grátis (modelo "local") por usuário/dia — usada para
// limitar o custo da chave do servidor. Ver DEMO_LIMITE_DIA / demoUsosHoje().
pool.query(`
  CREATE TABLE IF NOT EXISTS ai_demo_usage (
    user_id INTEGER NOT NULL,
    dia     DATE NOT NULL,
    usos    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, dia)
  )
`).catch(() => {})

// Histórico de atividade do Agente IA — visível só para super_admin, criado
// para diagnosticar erros (limite de requisições, chave inválida, falha do
// LLM) sem depender de acessar logs do Railway. Tabela dedicada (em vez de
// reaproveitar "logs") porque a regra de visibilidade aqui é fixa (só
// super_admin vê tudo, sem a lógica de "dono da conta" que "logs" usa).
pool.query(`
  CREATE TABLE IF NOT EXISTS ai_activity_log (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER,
    acao      TEXT NOT NULL,
    status    TEXT NOT NULL,
    modelo    TEXT,
    detalhes  TEXT,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {})

// Grava uma linha no histórico de atividade do Agente IA. Nunca lança —
// falha ao registrar não deve derrubar a ação real do usuário (gerar post,
// agendar, etc.), que é o que de fato importa pra ele.
async function registrarAtividadeIA({ userId, acao, status, modelo = null, detalhes = null }) {
  try {
    await pool.query(
      `INSERT INTO ai_activity_log (user_id, acao, status, modelo, detalhes) VALUES ($1, $2, $3, $4, $5)`,
      [userId, acao, status, modelo, detalhes ? String(detalhes).slice(0, 2000) : null]
    )
  } catch { /* melhor esforço — nunca bloqueia a ação real do usuário */ }
}

// Histórico das mensagens trocadas no chat do Agente IA — até aqui vivia só
// em memória do navegador (aiChat.fab/page.msgs, public/app.html) e se
// perdia a cada reload. Persistido para que admin/super_admin consigam
// acompanhar as conversas dos usuários (ex.: suporte, diagnóstico).
pool.query(`
  CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    contexto  TEXT NOT NULL,
    role      TEXT NOT NULL,
    conteudo  TEXT NOT NULL,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {})
pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user ON ai_chat_messages (user_id, criado_em DESC)`).catch(() => {})

// POST /api/ai/chat-messages — grava uma mensagem do chat (chamado pelo
// frontend a cada mensagem enviada/recebida). Nunca lança para o cliente
// além do essencial — perder uma mensagem do histórico não deve travar a
// conversa em andamento.
router.post('/chat-messages', async (req, res) => {
  try {
    const { contexto, role, conteudo } = req.body || {}
    if (!['fab', 'page'].includes(contexto)) return res.status(400).json({ erro: 'contexto inválido' })
    if (!['user', 'agent'].includes(role)) return res.status(400).json({ erro: 'role inválido' })
    if (!conteudo || typeof conteudo !== 'string') return res.status(400).json({ erro: 'conteudo é obrigatório' })

    await pool.query(
      `INSERT INTO ai_chat_messages (user_id, contexto, role, conteudo) VALUES ($1, $2, $3, $4)`,
      [req.user.id, contexto, role, conteudo.slice(0, 8000)]
    )
    res.status(201).json({ ok: true })
  } catch (err) { serverError(res, err) }
})

// GET /api/ai/chat-messages — histórico de conversas do Agente IA. Cada
// usuário só vê o próprio histórico, mesmo admin/super_admin — conversas com
// a IA são sempre privadas ao próprio usuário. Paginado por limit/offset
// (padrão 200 mais recentes).
router.get('/chat-messages', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 1000)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)

    const userId = req.user.id

    const cond = ['m.user_id = $1']
    const params = [userId]
    if (req.query.contexto) { params.push(req.query.contexto); cond.push(`m.contexto = $${params.length}`) }

    params.push(limit); const limitIdx = params.length
    params.push(offset); const offsetIdx = params.length

    const { rows } = await pool.query(`
      SELECT m.id, m.user_id AS "userId", u.email AS "userEmail", m.contexto, m.role, m.conteudo, m.criado_em AS "criadoEm"
      FROM ai_chat_messages m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE ${cond.join(' AND ')}
      ORDER BY m.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params)

    const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM ai_chat_messages m WHERE ${cond.join(' AND ')}`, params.slice(0, params.length - 2))

    res.json({ mensagens: rows, total })
  } catch (err) { serverError(res, err) }
})

// GET /api/ai/activity-log — histórico de atividade do Agente IA (só super_admin).
// Filtros opcionais: ?status=erro|sucesso|fallback|parcial, ?acao=generate|analyze-media|schedule|publish-now,
// ?userId=<id>. Paginado por limit/offset (padrão 100 mais recentes).
router.get('/activity-log', requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)

    const cond = []
    const params = []
    if (req.query.status) { params.push(req.query.status); cond.push(`l.status = $${params.length}`) }
    if (req.query.acao)   { params.push(req.query.acao);   cond.push(`l.acao = $${params.length}`) }
    if (req.query.userId) { params.push(parseInt(req.query.userId)); cond.push(`l.user_id = $${params.length}`) }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : ''

    params.push(limit); const limitIdx = params.length
    params.push(offset); const offsetIdx = params.length

    const { rows } = await pool.query(`
      SELECT l.id, l.user_id AS "userId", u.email AS "userEmail", l.acao, l.status, l.modelo, l.detalhes, l.criado_em AS "criadoEm"
      FROM ai_activity_log l
      LEFT JOIN users u ON u.id = l.user_id
      ${where}
      ORDER BY l.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params)

    const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM ai_activity_log l ${where}`, params.slice(0, params.length - 2))

    res.json({ logs: rows, total })
  } catch (err) { serverError(res, err) }
})

// Faz uma chamada mínima e barata ao provedor para confirmar que a chave é
// válida antes de salvar — evita que o usuário só descubra que errou a chave
// quando tentar gerar um post de verdade, minutos depois.
async function testarChaveProvedor(modelo, apiKey) {
  if (OPENAI_MODEL_IDS[modelo]) {
    const OpenAI = require('openai')
    const client = new OpenAI({ apiKey })
    await client.models.list()
    return
  }
  if (OPENROUTER_MODEL_IDS[modelo]) {
    const OpenAI = require('openai')
    const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })
    await client.models.list()
    return
  }
  if (CLAUDE_MODEL_IDS[modelo]) {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    // Anthropic não tem endpoint de "list models" público simples — usamos uma
    // chamada de 1 token, que é a forma mais barata de validar a chave.
    await client.messages.create({
      model: CLAUDE_MODEL_IDS[modelo],
      max_tokens: 1,
      messages: [{ role: 'user', content: 'oi' }],
    })
    return
  }
  if (GEMINI_MODEL_IDS[modelo]) {
    const { GoogleGenAI } = require('@google/genai')
    const savedGoogleKey = process.env.GOOGLE_API_KEY
    delete process.env.GOOGLE_API_KEY
    try {
      const client = new GoogleGenAI({ apiKey })
      await client.models.generateContent({ model: GEMINI_MODEL_IDS[modelo], contents: 'oi' })
    } finally {
      if (savedGoogleKey) process.env.GOOGLE_API_KEY = savedGoogleKey
    }
    return
  }
  throw Object.assign(new Error('Modelo não suporta teste de chave.'), { status: 400 })
}

// POST /api/ai/apikey/test — valida a chave do usuário direto no provedor,
// sem salvar nada. O frontend chama isso antes do PUT /apikey para mostrar
// erro imediato ("chave inválida ou sem permissão") em vez de só descobrir
// depois, ao tentar gerar um post de verdade.
router.post('/apikey/test', async (req, res) => {
  try {
    const { modelo, apiKey } = req.body || {}
    if (!modelo || !apiKey?.trim()) return res.status(400).json({ erro: 'modelo e apiKey são obrigatórios' })
    await testarChaveProvedor(modelo, apiKey.trim())
    res.json({ valid: true })
  } catch (err) {
    res.status(400).json({ valid: false, erro: 'Chave inválida ou sem permissão para esse modelo.' })
  }
})

// PUT /api/ai/apikey — salva ou atualiza a API key do usuário para um modelo
router.put('/apikey', async (req, res) => {
  try {
    const { modelo, apiKey } = req.body || {}
    if (!modelo || !apiKey?.trim()) return res.status(400).json({ erro: 'modelo e apiKey são obrigatórios' })
    const chave = apiKey.trim()
    const encrypted = encrypt(chave)
    const lastFour = chave.slice(-4)
    await pool.query(`
      INSERT INTO user_ai_keys (user_id, modelo, api_key, last_four, status)
      VALUES ($1, $2, $3, $4, 'valid')
      ON CONFLICT (user_id, modelo) DO UPDATE SET api_key = EXCLUDED.api_key, last_four = EXCLUDED.last_four, status = 'valid', criado_em = NOW()
    `, [req.user.id, modelo, encrypted, lastFour])
    res.json({ ok: true })
  } catch (err) { serverError(res, err) }
})

// GET /api/ai/apikey/:modelo — verifica se o usuário tem key salva para o modelo
router.get('/apikey/:modelo', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT last_four, status FROM user_ai_keys WHERE user_id = $1 AND modelo = $2`,
      [req.user.id, req.params.modelo]
    )
    const row = rows[0]
    res.json({ hasKey: !!row, lastFour: row?.last_four || null, status: row?.status || null })
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
      else if (modelo === 'openrouter') rawText = await generateWithOpenRouter(prompt)
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

// POST /api/ai/image/generate — gera imagem via Google Imagen. Usa a chave
// própria do usuário quando cadastrada; sem ela, cai para GEMINI_API_KEY do
// servidor (mesma chave já usada pelo chat de texto, ver generateWithGemini)
// em vez de recusar — o chat mostra pro usuário qual chave está em uso.
// Chamada roda "em segundo plano" da perspectiva do chat (aiHandleImageRequest
// no frontend): o modelo de TEXTO selecionado pelo usuário não muda, só essa
// requisição pontual usa o Gemini para a parte de imagem.
router.post('/image/generate', async (req, res) => {
  const { descricao } = req.body || {}
  if (!descricao?.trim()) return res.status(400).json({ erro: 'Descrição é obrigatória' })

  const userKey = await getUserApiKey(pool, req.user.id, 'gemini')
  const usandoChaveServidor = !userKey
  const key = userKey || process.env.GEMINI_API_KEY
  if (!key) return res.status(402).json({ erro: 'sem_chave' })

  try {
    const { GoogleGenAI } = require('@google/genai')
    const client = new GoogleGenAI({ apiKey: key })
    const result = await client.models.generateImages({
      model: 'imagen-4.0-generate-preview-05-20',
      prompt: descricao.trim(),
      config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
    })

    const imgData = result.generatedImages?.[0]?.image?.imageBytes
    if (!imgData) return res.status(500).json({ erro: 'Imagem não gerada. Tente novamente.' })

    registrarAtividadeIA({ userId: req.user.id, acao: 'image-generate', status: 'sucesso', modelo: 'gemini', detalhes: usandoChaveServidor ? 'chave do servidor' : 'chave do usuário' })
    res.json({ image: `data:image/jpeg;base64,${imgData}`, chaveServidor: usandoChaveServidor })
  } catch (err) {
    console.error('[AI Image]', err.message)
    registrarAtividadeIA({ userId: req.user.id, acao: 'image-generate', status: 'erro', modelo: 'gemini', detalhes: `${usandoChaveServidor ? 'chave do servidor' : 'chave do usuário'}: ${err.message}` })
    if (err.message?.includes('billing')) return res.status(402).json({ erro: 'billing', chaveServidor: usandoChaveServidor })
    if (err.message?.includes('quota') || err.message?.includes('429')) return res.status(429).json({ erro: 'quota', chaveServidor: usandoChaveServidor })
    return res.status(500).json({ erro: err.message || 'Erro ao gerar imagem.', chaveServidor: usandoChaveServidor })
  }
})

// POST /api/ai/image/generate-openrouter — gera TEXTO e IMAGEM juntos, na
// mesma chamada, via modelo multimodal do OpenRouter (Nano Banana 2 Lite).
// Sempre exige chave própria do usuário no OpenRouter (mesmo padrão do
// Imagen/Gemini em /image/generate) — sem chave do servidor aqui.
router.post('/image/generate-openrouter', async (req, res) => {
  try {
    const { descricao } = req.body || {}
    if (!descricao?.trim()) return res.status(400).json({ erro: 'Descrição é obrigatória' })

    const userKey = await getUserApiKey(pool, req.user.id, 'openrouter')
    if (!userKey) return res.status(402).json({ erro: 'sem_chave' })

    const OpenAI = require('openai')
    const client = new OpenAI({ apiKey: userKey, baseURL: 'https://openrouter.ai/api/v1' })
    const completion = await client.chat.completions.create({
      model: OPENROUTER_IMAGE_MODEL,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: descricao.trim() }],
    })

    const message = completion.choices[0]?.message
    const imageUrl = message?.images?.[0]?.image_url?.url
    if (!imageUrl) return res.status(500).json({ erro: 'Imagem não gerada. Tente novamente.' })

    res.json({ image: imageUrl, texto: message?.content || '' })
  } catch (err) {
    console.error('[AI Image OpenRouter]', err.message)
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

// POST /api/ai/analyze-media — analisa imagem/vídeo e sugere texto para redes
// sociais, usando o modelo escolhido pelo usuário no seletor do Agente IA
// (Gemini, OpenAI, OpenRouter ou Claude) — mesma checagem de chave própria vs.
// chave do servidor já usada em /generate para cada provedor.
router.post('/analyze-media', async (req, res) => {
  try {
    const { mediaBase64, mimeType, plataformas = ['instagram'], contexto = '', modelo = 'gemini' } = req.body || {}
    if (!mimeType) return res.status(400).json({ erro: 'mimeType é obrigatório' })

    const userKey = await getUserApiKey(pool, req.user.id, modelo)

    const platDesc = plataformas.map(p => PLATFORM_HINTS[p] || p).join('; ')
    const contextoHint = contexto?.trim() ? `\n\nContexto adicional do usuário: "${contexto.trim()}"` : ''

    const prompt = `Você é um especialista em marketing digital. Analise esta mídia e crie sugestões de posts para redes sociais.

Plataformas alvo: ${platDesc}${contextoHint}

Para cada plataforma, forneça:
- Um texto de post otimizado para aquela rede
- Hashtags relevantes (array de strings sem #)
- Um título (só para YouTube)

Responda APENAS com JSON válido, sem texto antes ou depois:
{
  "descricao_midia": "breve descrição do que está na mídia (1 frase)",
  "sugestoes": [
    {
      "plataforma": "instagram",
      "texto": "...",
      "hashtags": ["hashtag1", "hashtag2"],
      "titulo": ""
    }
  ]
}`

    const isVideo = !mediaBase64
    const rawText = await analisarMidiaComModelo({ modelo, prompt, mediaBase64, mimeType, userKey, isVideo })

    let parsed
    try { parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || '{}') } catch { parsed = {} }

    // Diferente de /generate, aqui já se sabe o tipo real da mídia (imagem ou
    // vídeo) — então aplica o limite exato da plataforma de cada sugestão
    // (ex: TikTok foto = 90 chars, TikTok vídeo = 2200), em vez do limite
    // genérico mais permissivo.
    const mediaType = isVideo ? 'video' : 'image'
    const sugestoes = (parsed.sugestoes || []).map(s => {
      const { post: ajustado } = ajustarPostParaPlataformas(
        { texto: s.texto || '', titulo: s.titulo || '' },
        [s.plataforma],
        mediaType
      )
      return { ...s, texto: ajustado.texto, titulo: ajustado.titulo }
    })
    registrarAtividadeIA({
      userId: req.user.id, acao: 'analyze-media', status: 'sucesso', modelo,
      detalhes: `${sugestoes.length} sugestão(ões) · ${isVideo ? 'vídeo' : 'imagem'} · plataformas: ${plataformas.join(',')}`,
    })
    res.json({
      descricao_midia: parsed.descricao_midia || '',
      sugestoes,
    })
  } catch (err) {
    const msg = err.message || ''
    registrarAtividadeIA({ userId: req.user.id, acao: 'analyze-media', status: 'erro', modelo: req.body?.modelo || 'gemini', detalhes: msg })
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) return res.status(429).json({ erro: 'Limite de requisições atingido. Tente novamente.' })
    console.error('[AI analyze-media]', msg)
    serverError(res, err)
  }
})

// GET /api/ai/models — retorna quais modelos estão disponíveis (chave
// configurada no servidor OU exige chave própria do usuário, marcado como
// sempre "disponível" já que basta o usuário colar a chave dele).
router.get('/models', (req, res) => {
  const hasGemini = !!process.env.GEMINI_API_KEY
  const hasOpenai = !!process.env.OPENAI_API_KEY
  const hasOpenrouter = !!process.env.OPENROUTER_API_KEY
  res.json({
    models: [
      { id: 'local',             name: 'Assistente Rápido',      provider: 'Sem conta',      available: true },
      { id: 'gemini',            name: 'Gemini 2.0 Flash',      provider: 'Google',    available: hasGemini },
      { id: 'gemini-2.5-flash',  name: 'Gemini 2.5 Flash',      provider: 'Google',    available: hasGemini },
      { id: 'gemini-2.5-pro',    name: 'Gemini 2.5 Pro',        provider: 'Google',    available: hasGemini },
      { id: 'gemini-2.5-lite',   name: 'Gemini 2.5 Flash-Lite', provider: 'Google',    available: hasGemini },
      { id: 'openai',            name: 'GPT-4o Mini',            provider: 'OpenAI',   available: hasOpenai },
      { id: 'openai-4o',         name: 'GPT-4o',                 provider: 'OpenAI',   available: hasOpenai },
      { id: 'openrouter',        name: 'GPT-OSS 20B (OpenRouter)', provider: 'OpenRouter', available: hasOpenrouter },
      // Gera texto E imagem juntos na mesma resposta (Nano Banana 2 Lite) —
      // sempre exige chave própria do usuário no OpenRouter, por isso
      // "available: false" fixo aqui (mesmo padrão do Claude acima): não
      // bloqueia o uso, só evita seleção automática como modelo padrão.
      { id: 'openrouter-image',  name: 'Texto + Imagem (OpenRouter)', provider: 'OpenRouter', available: false },
      // Claude não tem chave do servidor configurada — "available: false" aqui
      // não bloqueia o uso, só evita que o app selecione Claude como modelo
      // padrão automático (o usuário ainda escolhe manualmente no seletor e
      // configura a própria chave, via requiresKey no picker do frontend).
      { id: 'claude',            name: 'Claude Haiku',           provider: 'Anthropic', available: false },
      { id: 'claude-sonnet',     name: 'Claude Sonnet 5',        provider: 'Anthropic', available: false },
    ]
  })
})

// POST /api/ai/schedule
// Aceita publishNow (por post ou no nível raiz) para publicar imediatamente
// em vez de agendar. Também aceita mediaPath/mediaType — quando presentes
// (post veio do fluxo de análise de mídia do agente, com o arquivo já
// enviado ao Blob), publishNow é liberado mesmo para redes que exigem mídia
// (Instagram/YouTube/TikTok). Sem mídia, só é seguro publicar agora quando
// NENHUMA plataforma do post exigir mídia (hoje, só o Facebook aceita post
// de só texto) — validado aqui mesmo se o front mandar publishNow errado.
router.post('/schedule', async (req, res) => {
  try {
    const { posts } = req.body
    if (!Array.isArray(posts) || !posts.length) return res.status(400).json({ erro: 'Nenhum post para agendar' })

    const repo = require('../infra/db/postsRepository')
    const contasRepo = require('../repositories/contasRepository')
    const { publishPost } = require('../infra/social/publisher')
    const criados = []

    for (const p of posts) {
      const querPublicarAgora = p.publishNow === true || req.body.publishNow === true
      const temMidia = !!p.mediaPath
      const exigeMidia = (p.plataformas || []).some(plat => PLATFORM_REQUIREMENTS[plat]?.media === 'required')
      const publishNow = querPublicarAgora && (temMidia || !exigeMidia)

      // Resolve as contas conectadas de cada rede marcada e as vincula ao post
      // (post_accounts) — sem isso, publishPost() não teria nenhuma conta para
      // publicar (post.accounts viria vazio) e Promise.all([]).every(...)
      // retornaria true por vacuidade, marcando o post como "published" sem
      // nenhuma chamada real à API da rede. Mesmo padrão do Agendador manual
      // (ver use-cases/posts/criarPost.js).
      const isAdmin = isAdminRole(req.user.role)
      const contas = await contasRepo.listarContasAtivasPorPlataformas(p.plataformas || [], req.user.id, isAdmin)
      const platformsSemConta = (p.plataformas || []).filter(plat => !contas.some(c => c.platform === plat))
      if (platformsSemConta.length) {
        const labels = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
        const nomes = platformsSemConta.map(plat => labels[plat] || plat).join(', ')
        registrarAtividadeIA({ userId: req.user.id, acao: 'schedule', status: 'erro', detalhes: `sem conta conectada: ${nomes}` })
        return res.status(400).json({ erro: `Nenhuma conta de ${nomes} conectada. Conecte uma conta ou desmarque a rede.` })
      }

      const post = await repo.criarPost({
        text:              p.texto,
        platforms:         p.plataformas,
        scheduledAt:       publishNow ? new Date() : new Date(p.horario),
        repeat:            'none',
        mediaPath:         p.mediaPath || null,
        mediaType:         p.mediaType || null,
        mediaItems:        null,
        youtubeTitle:      p.titulo || null,
        youtubeVisibility: 'public',
        youtubeIsShort:    null,
        accountId:         p.accountId || null,
        userId:            req.user.id,
        status:            publishNow ? 'processing' : 'scheduled',
      })

      await repo.definirContasDoPost(post.id, contas.map(c => c.id))
      const postAccounts = await repo.listarContasDoPost(post.id)

      if (!publishNow) {
        registrarAtividadeIA({ userId: req.user.id, acao: 'schedule', status: 'sucesso', detalhes: `agendado · plataformas: ${(p.plataformas||[]).join(',')} · horário: ${post.scheduledAt || p.horario}` })
        criados.push(post)
        continue
      }

      const results = await publishPost({ ...post, mediaPath: p.mediaPath || null, mediaType: p.mediaType || null, mediaItems: null, accounts: postAccounts, userId: req.user.id, userRole: req.user.role })
      // Instagram devolve "pending" (container ainda processando) — o cron
      // finaliza depois; não é sucesso nem erro ainda nesse momento.
      const status = results.some(r => r.success === 'pending') ? 'processing'
        : results.every(r => r.success === true) ? 'published'
        : results.some(r => r.success === true) ? 'partial'
        : 'error'
      await repo.atualizarStatusPost(post.id, status)
      registrarAtividadeIA({
        userId: req.user.id, acao: 'publish-now', status: status === 'error' ? 'erro' : status === 'partial' ? 'parcial' : 'sucesso',
        detalhes: `plataformas: ${(p.plataformas||[]).join(',')}${status === 'error' || status === 'partial' ? ` · ${results.filter(r=>!r.success).map(r=>`${r.platform}: ${r.error}`).join('; ')}` : ''}`,
      })
      criados.push({ ...post, status, results })
    }

    res.status(201).json({ agendados: criados.length, posts: criados })
  } catch (err) {
    registrarAtividadeIA({ userId: req.user.id, acao: 'schedule', status: 'erro', detalhes: err.message })
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
