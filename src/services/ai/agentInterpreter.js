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

function extractContent(message) {
  const text = String(message)
  const colon = text.match(/:\s*([\s\S]+)$/)
  if (colon) return colon[1].replace(/["“”']+$/, '').trim()
  const match = text.match(/(?:dizendo|com o texto|que|para lembrar(?: que)?)\s*[:\-]?\s*([\s\S]+)$/i)
  return (match?.[1] || '').replace(/["“”']+$/, '').trim()
}

function extractScheduledAt(message, now = new Date()) {
  const normalized = normalize(message)
  const hourMatch = normalized.match(/(?:as|às)\s*(\d{1,2})(?:\s*[h:]\s*(\d{1,2}))?/) || normalized.match(/(\d{1,2})\s*h(?:\s*(\d{1,2}))?/)
  if (!hourMatch) return null
  const hour = Number(hourMatch[1])
  const minute = Number(hourMatch[2] || 0)
  if (hour > 23 || minute > 59) return null

  const dateMatch = normalized.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](20\d{2}))?\b/)
  let date
  if (dateMatch) {
    const day = Number(dateMatch[1])
    const month = Number(dateMatch[2]) - 1
    const year = Number(dateMatch[3] || now.getFullYear())
    date = new Date(year, month, day)
  } else {
    date = new Date(now)
    if (/depois de amanha/.test(normalized)) date.setDate(date.getDate() + 2)
    else if (/amanha/.test(normalized)) date.setDate(date.getDate() + 1)
    else if (!/hoje/.test(normalized)) return null
  }
  date.setHours(hour, minute, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
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

function isLikelyFieldReply(message) {
  const normalized = normalize(message)
  if (/^(abra|abrir|mostre|mostrar|quero ver|crie|criar|gere|gerar|cancele|cancelar|exclua|excluir|salve|salvar|consulte|consultar|responda|reagende|reagendar)\b/.test(normalized)) return false
  return true
}

function completePendingPlan(message, pendingPlan) {
  if (!pendingPlan || !getCapability(pendingPlan.actionId) || !Array.isArray(pendingPlan.missingFields) || !pendingPlan.missingFields.length) return null
  if (!isLikelyFieldReply(message)) return null

  const text = String(message || '').trim()
  const args = { ...(pendingPlan.arguments || {}) }
  const numbers = [...text.matchAll(/#?(\d+)/g)].map(match => Number(match[1])).filter(Number.isInteger)
  for (const field of pendingPlan.missingFields) {
    if (field === 'postId' || field === 'id' || field === 'accountId') {
      const value = numbers.shift()
      if (value) args[field] = value
    } else if (field === 'commentId') {
      const value = numbers.shift()
      if (value) args[field] = value
    } else if (field === 'scheduledAt') {
      const value = extractScheduledAt(text)
      if (value) args[field] = value
    } else if (['text', 'body', 'content'].includes(field) && text) {
      args[field] = text
    } else if (field === 'platforms') {
      const platforms = extractPlatforms(text)
      if (platforms.length) args[field] = platforms
    }
  }

  const missingFields = pendingPlan.missingFields.filter(field => {
    const value = args[field]
    return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)
  })
  const capability = getCapability(pendingPlan.actionId)
  return {
    ...pendingPlan,
    arguments: args,
    missingFields,
    requiresConfirmation: Boolean(capability.confirmation),
    source: 'conversation',
    answer: missingFields.length
      ? `Ainda preciso de: ${missingFields.join(', ')}.`
      : capability.confirmation ? 'Agora tenho os dados necessários. Confirme para continuar.' : 'Agora tenho os dados necessários e vou continuar.',
  }
}

function interpretWithRules(message, currentPage) {
  const text = String(message || '').trim()
  const normalized = normalize(text)
  if (!text) return { ...basePlan('show_capabilities'), missingFields: ['message'], answer: 'Digite o que você precisa fazer na aplicação.' }

  if (/^(ajuda|help|menu|o que (voce|você) consegue|quais (sao|são) suas funcoes|funcoes disponiveis|capacidades)/i.test(normalized)) {
    return basePlan('show_capabilities', {}, 'Estas são as funções que posso executar ou abrir para você.')
  }

  // Ações específicas vêm antes da navegação por módulo: frases como
  // "mostre o histórico de métricas" também contêm o alias "analytics".
  if (/reagend|mude.*horario|alter.*horario|troque.*horario/.test(normalized) && /post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    const scheduledAt = extractScheduledAt(text)
    const missingFields = [postId ? null : 'postId', scheduledAt ? null : 'scheduledAt'].filter(Boolean)
    return { ...basePlan('reschedule_post', { postId, scheduledAt }), missingFields, answer: missingFields.length ? 'Para reagendar, preciso do ID do post e de uma data e horário, por exemplo: amanhã às 10h.' : 'Posso reagendar essa publicação. Confirme para continuar.' }
  }
  if (/(?:cancel|cancele|excluir|apagar|remover)/.test(normalized) && /post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('cancel_post', { postId }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Posso cancelar essa publicação. Confirme para continuar.' : 'Informe o ID do post que deseja cancelar.' }
  }
  if (/(?:marcar|marque)/.test(normalized) && /coment/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('mark_comments_seen', { postId, commentIds: [] }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Posso marcar os comentários desse post como vistos. Confirme para continuar.' : 'Informe o ID do post cujos comentários deseja marcar como vistos.' }
  }
  if (/historico|histórico|evolucao|evolução/.test(normalized) && /metric|post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('metrics_history', { postId }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Vou carregar o histórico de métricas desse post.' : 'Informe o ID do post para consultar o histórico.' }
  }
  if (/(?:detalhe|informacoes|informações|dados)\b/.test(normalized) && /post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('post_details', { postId }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Vou carregar os detalhes dessa publicação.' : 'Informe o ID do post para eu mostrar os detalhes.' }
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
  if (/reagend|mude.*horario|alter.*horario|troque.*horario/.test(normalized) && /post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    const scheduledAt = extractScheduledAt(text)
    const missingFields = [postId ? null : 'postId', scheduledAt ? null : 'scheduledAt'].filter(Boolean)
    return { ...basePlan('reschedule_post', { postId, scheduledAt }), missingFields, answer: missingFields.length ? 'Para reagendar, preciso do ID do post e de uma data e horário, por exemplo: amanhã às 10h.' : 'Posso reagendar essa publicação. Confirme para continuar.' }
  }
  if (/(?:cancel|cancele|excluir|apagar|remover)/.test(normalized) && /post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('cancel_post', { postId }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Posso cancelar essa publicação. Confirme para continuar.' : 'Informe o ID do post que deseja cancelar.' }
  }
  if (/historico|histórico|evolucao|evolução/.test(normalized) && /metric|post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('metrics_history', { postId }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Vou carregar o histórico de métricas desse post.' : 'Informe o ID do post para consultar o histórico.' }
  }
  if (/(?:detalhe|informacoes|informações|dados)\b/.test(normalized) && /post|publicacao|publicação/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('post_details', { postId }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Vou carregar os detalhes dessa publicação.' : 'Informe o ID do post para eu mostrar os detalhes.' }
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
  if (/(?:nao lido|não lido|nao vistos|não vistos|novos comentarios|novos comentários)/.test(normalized)) return basePlan('unread_inbox', {}, 'Vou verificar seus comentários não lidos.')
  if (/(?:marcar|marque)/.test(normalized) && /coment/.test(normalized)) {
    const postId = extractId(text, ['post', 'publicacao', 'publicação'])
    return { ...basePlan('mark_comments_seen', { postId, commentIds: [] }), missingFields: postId ? [] : ['postId'], answer: postId ? 'Posso marcar os comentários desse post como vistos. Confirme para continuar.' : 'Informe o ID do post cujos comentários deseja marcar como vistos.' }
  }
  const contentIntent = /gerar|gere|criar|crie|escrever|escreva|sugerir|sugira|ideia|legenda|caption/.test(normalized)
    && /post|conteudo|publica|instagram|facebook|youtube|tiktok/.test(normalized)
  if (!contentIntent && /metric|analytics|relatorio|desempenho|resultado/.test(normalized) && /analise|melhorar|recomend|insight|perform|o que fazer|proximo passo/.test(normalized)) return basePlan('analytics_insight', {}, 'Vou analisar seus dados e sugerir próximos passos.')
  if (!contentIntent && /metric|analytics|relatorio|relatório|desempenho|resultado/.test(normalized)) return basePlan('analytics', {}, 'Vou consultar seus relatórios.')
  if (/calendario|calendário|o que tenho agendado|publicacoes.*mes|publicações.*mês/.test(normalized)) return basePlan('calendar', extractMonth(text), 'Vou consultar o calendário desse período.')
  if (/requisit|exige.*(instagram|facebook|youtube|tiktok)|limite.*(instagram|facebook|youtube|tiktok)/.test(normalized)) return basePlan('requirements', { platforms: extractPlatforms(text) }, 'Vou explicar os requisitos de publicação.')
  if (/contas conect|quais contas|listar contas|minhas redes/.test(normalized)) return basePlan('list_accounts', { platform: extractPlatforms(text)[0] || null }, 'Vou consultar suas contas conectadas.')
  if (/painel|dashboard|resumo.*conta|quantas contas/.test(normalized)) return basePlan('dashboard_summary', {}, 'Vou consultar o resumo do seu painel.')
  if (/(?:video|vídeo)s?.*tiktok|tiktok.*(?:video|vídeo)s?/.test(normalized) && /listar|mostrar|ver|meus|quais/.test(normalized)) return basePlan('tiktok_videos', {}, 'Vou consultar seus vídeos do TikTok.')
  if (/opcoes|opções|creator|criador/.test(normalized) && /tiktok/.test(normalized)) return basePlan('tiktok_creator_info', {}, 'Vou consultar as opções disponíveis no TikTok.')
  if (/texto[s]? salvo|textos reutilizaveis|textos reutilizáveis/.test(normalized) && /listar|mostrar|quais|meus|ver/.test(normalized)) return basePlan('list_saved_texts', {}, 'Vou consultar seus textos salvos.')
  if (/(?:salvar|salve|guardar|guarde).*(?:texto|frase)/.test(normalized)) {
    const body = extractContent(text)
    return { ...basePlan('save_text', { title: 'Texto salvo', body }), missingFields: body ? [] : ['body'], answer: body ? 'Posso salvar esse texto para reutilização. Confirme para continuar.' : 'Envie o texto que deseja salvar.' }
  }
  if (/(?:excluir|apagar|remover|deletar).*(?:texto salvo|texto reutilizavel|texto reutilizável)/.test(normalized)) {
    const id = extractId(text, ['texto salvo', 'texto'])
    return { ...basePlan('delete_saved_text', { id }), missingFields: id ? [] : ['id'], answer: id ? 'Posso excluir esse texto salvo. Confirme para continuar.' : 'Informe o ID do texto salvo.' }
  }
  if (/preset|predefin|configuracoes salvas|configurações salvas/.test(normalized) && /listar|mostrar|quais|meus|ver/.test(normalized)) return basePlan('list_presets', { platform: extractPlatforms(text)[0] || null }, 'Vou consultar seus presets.')
  if (/(?:saude|saúde|disponibilidade).*(?:rede|plataforma|instagram|facebook|youtube|tiktok)/.test(normalized) || /(?:redes|plataformas).*funcionando/.test(normalized) || /status das plataformas/.test(normalized)) return basePlan('platform_health', {}, 'Vou consultar a saúde das plataformas.')
  if (/(?:logs|historico de atividades|histórico de atividades|ultimos erros|últimos erros)/.test(normalized)) return basePlan('list_logs', { limit: 50 }, 'Vou consultar as atividades recentes.')
  if (/(?:lembra|memoria|memória|preferencia|preferência).*(?:mim|minhas|sobre)/.test(normalized)) return basePlan('list_memories', {}, 'Vou consultar o que está salvo na memória da IA.')
  if (/(?:lembre|lembrar|salve na memoria|salve na memória)/.test(normalized)) {
    const content = extractContent(text)
    return { ...basePlan('save_memory', { content, type: 'nota', model: 'gemini' }), missingFields: content ? [] : ['content'], answer: content ? 'Posso guardar essa informação na memória. Confirme para continuar.' : 'Diga qual informação devo guardar.' }
  }
  if (/agendar|publicar agora|criar publicacao|criar publicação/.test(normalized)) return { ...basePlan('open_scheduler', {}), navigation: 'agendador', answer: 'Abrindo o Criador de Posts. Para publicar, ainda preciso da mídia, das redes e do horário quando forem exigidos.' }
  if (contentIntent) {
    const platforms = extractPlatforms(text)
    const tone = /profissional|formal/.test(normalized) ? 'profissional' : /motiv/.test(normalized) ? 'motivacional' : /inform/.test(normalized) ? 'informativo' : /humor|engrac|engraç/.test(normalized) ? 'humoristico' : 'casual'
    return basePlan('generate_posts', { instruction: text, platforms: platforms.length ? platforms : ['instagram'], quantity: 1, tone }, 'Vou gerar uma sugestão de conteúdo.')
  }
  if (/publica|post|agendad/.test(normalized) && /listar|mostrar|quais|ver/.test(normalized)) {
    const status = Object.keys(STATUS_ALIASES).find(alias => normalized.includes(alias))
    return basePlan('list_posts', { status: status ? STATUS_ALIASES[status] : null }, 'Vou consultar suas publicações.')
  }

  const openQuestion = /\?|\b(?:como|qual|quais|por que|porque|me ajude|estrategia|estratégia|sugestao|sugestão|ideias|o que devo|vale a pena|melhor forma|analise|análise|planeje|planejamento)\b/.test(normalized)
  if (openQuestion) return basePlan('conversation', { topic: text }, 'Vou analisar seu pedido e responder com uma orientação prática.')
  return { ...basePlan('show_capabilities'), actionId: 'unknown', confidence: 0, answer: `Não identifiquei uma ação específica${currentPage ? ` no módulo ${APP_PAGES[currentPage] || currentPage}` : ''}. Posso conversar sobre estratégia, conteúdo e redes sociais, ou executar uma ação da aplicação.` }
}

function buildAgentPrompt({ message, history = [], currentPage = null, pendingPlan = null }) {
  return `Você é o agente inteligente do Social API Manager. Converse em português do Brasil com clareza, naturalidade e iniciativa. Você pode executar UMA ação da aplicação OU responder uma pergunta aberta. Nunca invente dados da conta, métricas, posts, contas conectadas, IDs ou resultados: quando o usuário pedir dados reais, escolha a ação de consulta adequada. Se faltarem dados para uma ação, preencha missingFields e não execute. Ações de escrita exigem confirmação.

COMO RACIOCINAR:
- Para estratégia, ideias, explicações, diagnóstico conceitual ou dúvidas gerais, use actionId "conversation" e escreva uma resposta útil, específica e acionável em answer.
- Para pedidos de conteúdo, entenda objetivo, público, formato, tom e rede; use generate_posts quando o usuário quer textos prontos.
- Para pedidos compostos, responda a parte que puder e indique a próxima etapa mais segura; não execute várias escritas escondidas.
- Diferencie uma pergunta sobre a palavra "analytics" de uma consulta dos dados reais da conta.
- Não diga que fez algo se não houver uma ação executada e um resultado retornado.
- Faça no máximo uma pergunta de esclarecimento por vez quando isso melhorar muito a resposta.

CATÁLOGO:
${JSON.stringify(getCatalogForPrompt())}

MÓDULOS:
${JSON.stringify(APP_PAGES)}

MÓDULO ATUAL: ${currentPage || 'desconhecido'}
HISTÓRICO RECENTE:
${JSON.stringify(history.slice(-6))}
PLANO PENDENTE DE PREENCHIMENTO:
${JSON.stringify(pendingPlan)}

PEDIDO DO USUÁRIO:
${message}

Responda APENAS JSON válido neste formato:
{"actionId":"id_do_catalogo","arguments":{},"answer":"resposta completa em português","missingFields":[],"navigation":null,"confidence":0.0}`
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
    answer: typeof parsed.answer === 'string' ? parsed.answer.slice(0, 4000) : capability.description,
    confidence: Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1),
    missingFields,
    requiresConfirmation: Boolean(capability.confirmation),
    navigation: APP_PAGES[parsed.navigation] ? parsed.navigation : null,
    source: 'model',
  }
}

async function interpretAgentMessage({ message, history, currentPage, pendingPlan, generateText }) {
  const completedPlan = completePendingPlan(message, pendingPlan)
  if (completedPlan) return completedPlan
  const rulePlan = interpretWithRules(message, currentPage)
  if (!['unknown', 'conversation'].includes(rulePlan.actionId) || typeof generateText !== 'function') return rulePlan
  try {
    const raw = await generateText(buildAgentPrompt({ message, history, currentPage, pendingPlan }))
    if (!raw) return rulePlan
    return parseModelPlan(raw)
  } catch {
    return rulePlan
  }
}

module.exports = { buildAgentPrompt, interpretAgentMessage, interpretWithRules, parseModelPlan, extractPlatforms, completePendingPlan }
