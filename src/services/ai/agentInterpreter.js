const { APP_PAGES, getCapability, getCatalogForPrompt } = require('./agentCatalog')

const PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok']
const PAGE_ALIASES = {
  dashboard: 'dashboard', painel: 'dashboard', início: 'dashboard', inicio: 'dashboard',
  agendador: 'agendador', criador: 'agendador', publicar: 'agendador', publicação: 'agendador', publicacao: 'agendador',
  calendário: 'calendario', calendario: 'calendario', agenda: 'calendario',
  rascunho: 'rascunhos', rascunhos: 'rascunhos',
  relatório: 'analytics', relatorio: 'analytics', analytics: 'analytics', métricas: 'analytics', metricas: 'analytics',
  inbox: 'inbox', comentários: 'inbox', comentarios: 'inbox',
  contas: 'integracoes', integração: 'integracoes', integracao: 'integracoes',
  tokens: 'tokens', credenciais: 'tokens',
  ia: 'ai', assistente: 'ai', inteligência: 'ai', inteligencia: 'ai',
}

const STATUS_ALIASES = {
  agendado: 'scheduled', agendada: 'scheduled', agendadas: 'scheduled', agendados: 'scheduled',
  publicado: 'published', publicados: 'published', publicada: 'published', publicadas: 'published',
  parcial: 'partial', erro: 'error', erros: 'error', cancelado: 'cancelled', cancelados: 'cancelled',
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function extractPlatforms(text) {
  const normalized = normalize(text)
  return PLATFORMS.filter(platform => normalized.includes(platform))
}

function extractId(text, labels) {
  const normalized = normalize(text)
  const expression = new RegExp(`(?:${labels.join('|')})\\s*(?:de|do|da|no|na)?\\s*#?(\\d+)`, 'i')
  const match = normalized.match(expression)
  return match ? Number(match[1]) : null
}

function extractMonth(text, now = new Date()) {
  const normalized = normalize(text)
  let date = new Date(now.getFullYear(), now.getMonth(), 1)
  if (/proximo|seguinte/.test(normalized)) date = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  if (/passado|anterior/.test(normalized)) date = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  const year = Number(normalized.match(/\b20\d{2}\b/)?.[0]) || date.getFullYear()
  const monthNames = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  const namedMonth = monthNames.findIndex(month => normalized.includes(month))
  return { year, month: namedMonth >= 0 ? namedMonth + 1 : date.getMonth() + 1 }
}

function extractDraftText(message) {
  const match = String(message).match(/(?:rascunho|texto)\s*(?:com|de|:)?\s*(.*)$/i)
  return (match?.[1] || message).trim()
}

function basePlan(actionId, args = {}, answer = '') {
  const capability = getCapability(actionId)
  return {
    actionId,
    arguments: args,
    answer,
    confidence: capability ? 1 : 0,
    missingFields: [],
    requiresConfirmation: Boolean(capability?.confirmation),
    navigation: null,
    source: 'rules',
  }
}

function interpretWithRules(message, currentPage) {
  const text = String(message || '').trim()
  const normalized = normalize(text)
  if (!text) return { ...basePlan('show_capabilities'), missingFields: ['message'], answer: 'Digite o que você precisa fazer na aplicação.' }

  if (/^(ajuda|help|menu|o que (voce|você) consegue|quais (sao|são) suas funcoes|funcoes disponiveis|capacidades)/i.test(normalized)) {
    return basePlan('show_capabilities', {}, 'Estas são as funções que posso executar ou abrir para você.')
  }

  const page = Object.keys(PAGE_ALIASES).find(alias => normalized.includes(alias))
  if (/^(abra|abrir|ir para|va para|mostrar|mostre|acessar|quero ver)/i.test(normalized) && page) {
    const pageId = PAGE_ALIASES[page]
    return { ...basePlan('navigate', { page: pageId }), navigation: pageId, answer: `Abrindo ${APP_PAGES[pageId]}.` }
  }

  if (/conectar|vincular|adicionar.*conta/.test(normalized) && extractPlatforms(text).length) {
    const platform = extractPlatforms(text)[0]
    return { ...basePlan('connect_account', { platform }), navigation: 'integracoes', answer: `Abra o fluxo de conexão de ${platform} no módulo de contas.` }
  }
  if (/renovar.*token|token.*renovar/.test(normalized)) return basePlan('renew_tokens', {}, 'Posso renovar os tokens disponíveis. Confirme para continuar.')
  if (/desconectar|remover.*conta|excluir.*conta/.test(normalized)) {
    const id = extractId(text, ['conta', 'account'])
    return { ...basePlan('disconnect_account', { id }), missingFields: id ? [] : ['id'], answer: id ? 'Posso desconectar essa conta. Confirme para continuar.' : 'Informe o ID da conta que deseja desconectar.' }
  }
  if (/token|credencial/.test(normalized) && /expir|valid|status|listar|mostrar|quais/.test(normalized)) {
    const status = Object.keys(STATUS_ALIASES).find(alias => normalized.includes(alias))
    return basePlan('list_tokens', { platform: extractPlatforms(text)[0] || null, status: status ? STATUS_ALIASES[status] : null }, 'Vou consultar o estado dos seus tokens.')
  }
  if (/rascunho/.test(normalized) && /excluir|apagar|remover|deletar/.test(normalized)) {
    const id = extractId(text, ['rascunho', 'draft'])
    return { ...basePlan('delete_draft', { id }), missingFields: id ? [] : ['id'], answer: id ? 'Posso excluir esse rascunho. Confirme para continuar.' : 'Informe o ID do rascunho que deseja excluir.' }
  }
  if (/rascunho/.test(normalized) && /salvar|salve|criar|crie|guardar|anotar/.test(normalized)) {
    const draftText = extractDraftText(text)
    return { ...basePlan('create_draft', { text: draftText, title: 'Rascunho', platforms: extractPlatforms(text) }), missingFields: draftText ? [] : ['text'], answer: 'Posso salvar este conteúdo como rascunho. Confirme para continuar.' }
  }
  if (/rascunho/.test(normalized)) return basePlan('list_drafts', {}, 'Vou consultar seus rascunhos salvos.')
  if (/responder|responda/.test(normalized) && /coment/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    const commentId = extractId(text, ['comentario', 'comentário'])
    const saida = text.match(/(?:dizendo|responda com|resposta)\s*:?["“]?(.+?)["”]?$/i)?.[1]?.trim() || ''
    const missingFields = [postId ? null : 'postId', commentId ? null : 'commentId', saida ? null : 'text'].filter(Boolean)
    return { ...basePlan('reply_comment', { postId, commentId, text: saida }), missingFields, answer: missingFields.length ? 'Para responder, preciso do post, do comentário e do texto.' : 'Posso publicar essa resposta. Confirme para continuar.' }
  }
  if (/coment/.test(normalized) && /post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('list_comments', { postId }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Vou carregar os comentários desse post.' : 'Informe o ID do post para eu carregar os comentários.' }
  }
  if (/inbox|comentarios novos|comentários novos|interacoes|interações/.test(normalized)) return basePlan('list_inbox', { platform: extractPlatforms(text)[0] || null }, 'Vou consultar seu inbox.')
  if (/metric|analytics|relatorio|relatório|desempenho|resultado/.test(normalized)) return basePlan('analytics', {}, 'Vou consultar seus relatórios.')
  if (/calendario|calendário|o que tenho agendado|publicacoes.*mes|publicações.*mês/.test(normalized)) return basePlan('calendar', extractMonth(text), 'Vou consultar o calendário desse período.')
  if (/requisit|exige.*(instagram|facebook|youtube|tiktok)|limite.*(instagram|facebook|youtube|tiktok)/.test(normalized)) return basePlan('requirements', { platforms: extractPlatforms(text) }, 'Vou explicar os requisitos de publicação.')
  if (/contas conect|quais contas|listar contas|minhas redes/.test(normalized)) return basePlan('list_accounts', { platform: extractPlatforms(text)[0] || null }, 'Vou consultar suas contas conectadas.')
  if (/agendar|publicar agora|criar publicacao|criar publicação/.test(normalized)) return { ...basePlan('open_scheduler', {}), navigation: 'agendador', answer: 'Abrindo o Criador de Posts. Para publicar, ainda preciso da mídia, das redes e do horário quando forem exigidos.' }
  if (/gerar|gere|criar|crie|escrever|escreva|sugerir|sugira|ideia|legenda|caption/.test(normalized) && /post|conteudo|publica|instagram|facebook|youtube|tiktok/.test(normalized)) {
    const platforms = extractPlatforms(text)
    const tone = /profissional|formal/.test(normalized) ? 'profissional' : /motiv/.test(normalized) ? 'motivacional' : /inform/.test(normalized) ? 'informativo' : /humor|engrac|engraç/.test(normalized) ? 'humoristico' : 'casual'
    return basePlan('generate_posts', { instruction: text, platforms: platforms.length ? platforms : ['instagram'], quantity: 1, tone }, 'Vou gerar uma sugestão de conteúdo.')
  }
  if (/publica|post|agendad/.test(normalized) && /listar|mostrar|quais|ver/.test(normalized)) {
    const status = Object.keys(STATUS_ALIASES).find(alias => normalized.includes(alias))
    return basePlan('list_posts', { status: status ? STATUS_ALIASES[status] : null }, 'Vou consultar suas publicações.')
  }

  return { ...basePlan('show_capabilities'), actionId: 'unknown', confidence: 0, answer: `Não identifiquei uma ação específica${currentPage ? ` no módulo ${APP_PAGES[currentPage] || currentPage}` : ''}. Posso mostrar as funções disponíveis ou você pode descrever o resultado que deseja.` }
}

function buildAgentPrompt({ message, history = [], currentPage = null }) {
  return `Você é o agente operacional do Social API Manager. Interprete o pedido em português e escolha UMA ação do catálogo. Você nunca deve inventar uma ação, ID, conta, comentário ou resultado. Se faltarem dados, preencha missingFields e não execute a ação. Ações de escrita exigem confirmação.

CATÁLOGO:
${JSON.stringify(getCatalogForPrompt())}

MÓDULOS:
${JSON.stringify(APP_PAGES)}

MÓDULO ATUAL: ${currentPage || 'desconhecido'}
HISTÓRICO RECENTE:
${JSON.stringify(history.slice(-6))}

PEDIDO DO USUÁRIO:
${message}

Responda APENAS JSON válido neste formato:
{"actionId":"id_do_catalogo","arguments":{},"answer":"resposta curta","missingFields":[],"navigation":null,"confidence":0.0}`
}

function parseModelPlan(rawText) {
  const match = String(rawText || '').match(/\{[\s\S]*\}/)
  if (!match) throw new Error('A IA não retornou um plano JSON válido.')
  const parsed = JSON.parse(match[0])
  const capability = getCapability(parsed.actionId)
  if (!capability) throw new Error('A IA escolheu uma ação que não existe no catálogo.')
  const missingFields = Array.isArray(parsed.missingFields) ? parsed.missingFields.slice(0, 10).map(String) : []
  return {
    actionId: capability.id,
    arguments: parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {},
    answer: typeof parsed.answer === 'string' ? parsed.answer.slice(0, 1000) : capability.description,
    confidence: Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1),
    missingFields,
    requiresConfirmation: Boolean(capability.confirmation),
    navigation: APP_PAGES[parsed.navigation] ? parsed.navigation : null,
    source: 'model',
  }
}

async function interpretAgentMessage({ message, history, currentPage, generateText }) {
  const rulePlan = interpretWithRules(message, currentPage)
  if (rulePlan.actionId !== 'unknown' || typeof generateText !== 'function') return rulePlan
  try {
    const raw = await generateText(buildAgentPrompt({ message, history, currentPage }))
    if (!raw) return rulePlan
    return parseModelPlan(raw)
  } catch {
    return rulePlan
  }
}

module.exports = { buildAgentPrompt, interpretAgentMessage, interpretWithRules, parseModelPlan, extractPlatforms }
