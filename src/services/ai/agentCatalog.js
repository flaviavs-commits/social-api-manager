const APP_PAGES = {
  dashboard: 'Dashboard',
  agendador: 'Criador de Posts',
  calendario: 'Calendário',
  rascunhos: 'Rascunhos',
  analytics: 'Relatórios',
  inbox: 'Inbox',
  integracoes: 'Contas conectadas',
  tokens: 'Tokens',
  ai: 'Assistente IA',
}

const CAPABILITIES = [
  {
    id: 'show_capabilities', label: 'Mostrar capacidades', category: 'ajuda', mode: 'read',
    description: 'Explica tudo o que o agente pode fazer na aplicação.', examples: ['o que você consegue fazer?', 'me mostre as funções'],
  },
  {
    id: 'navigate', label: 'Abrir módulo', category: 'navegação', mode: 'read',
    description: 'Abre qualquer módulo da aplicação.', parameters: ['page'], examples: ['abra o calendário', 'quero ver meus tokens'],
  },
  {
    id: 'generate_posts', label: 'Gerar conteúdo', category: 'conteúdo', mode: 'read',
    description: 'Gera ideias e textos de posts por tema, tom e plataforma, sem publicar automaticamente.',
    parameters: ['instruction', 'platforms', 'quantity', 'tone'], examples: ['crie um post profissional sobre promoção no Instagram'],
  },
  {
    id: 'list_posts', label: 'Listar publicações', category: 'publicações', mode: 'read',
    description: 'Consulta publicações do usuário por status.', parameters: ['status'], examples: ['quais posts estão agendados?'],
  },
  {
    id: 'calendar', label: 'Consultar calendário', category: 'publicações', mode: 'read',
    description: 'Mostra as publicações de um mês no calendário.', parameters: ['year', 'month'], examples: ['o que tenho agendado este mês?'],
  },
  {
    id: 'list_drafts', label: 'Listar rascunhos', category: 'conteúdo', mode: 'read',
    description: 'Lista os rascunhos salvos.', examples: ['mostre meus rascunhos'],
  },
  {
    id: 'create_draft', label: 'Criar rascunho', category: 'conteúdo', mode: 'write', confirmation: true,
    description: 'Salva um texto como rascunho, sem publicar.', parameters: ['text', 'title', 'platforms'], examples: ['salve como rascunho: campanha de inverno'],
  },
  {
    id: 'delete_draft', label: 'Excluir rascunho', category: 'conteúdo', mode: 'write', confirmation: true,
    description: 'Exclui um rascunho identificado pelo ID.', parameters: ['id'], examples: ['exclua o rascunho 12'],
  },
  {
    id: 'analytics', label: 'Consultar relatórios', category: 'desempenho', mode: 'read',
    description: 'Consulta métricas e desempenho das publicações e redes conectadas.', examples: ['como estão minhas métricas?'],
  },
  {
    id: 'list_inbox', label: 'Consultar inbox', category: 'relacionamento', mode: 'read',
    description: 'Lista publicações com comentários disponíveis para atendimento.', parameters: ['platform'], examples: ['tenho comentários para responder?'],
  },
  {
    id: 'list_comments', label: 'Ler comentários', category: 'relacionamento', mode: 'read',
    description: 'Carrega os comentários de uma publicação pelo ID.', parameters: ['postId'], examples: ['mostre os comentários do post 42'],
  },
  {
    id: 'reply_comment', label: 'Responder comentário', category: 'relacionamento', mode: 'write', confirmation: true,
    description: 'Publica uma resposta em um comentário identificado por post e comentário.', parameters: ['postId', 'commentId', 'text'], examples: ['responda o comentário 7 do post 42 dizendo obrigado'],
  },
  {
    id: 'list_accounts', label: 'Listar contas', category: 'integrações', mode: 'read',
    description: 'Lista as contas de Facebook, Instagram, YouTube e TikTok conectadas.', parameters: ['platform'], examples: ['quais contas estão conectadas?'],
  },
  {
    id: 'connect_account', label: 'Conectar conta', category: 'integrações', mode: 'read',
    description: 'Orienta a abertura do módulo para iniciar OAuth; a autorização final ocorre no provedor.', parameters: ['platform'], examples: ['quero conectar meu Instagram'],
  },
  {
    id: 'disconnect_account', label: 'Desconectar conta', category: 'integrações', mode: 'write', confirmation: true,
    description: 'Remove uma conta conectada identificada pelo ID.', parameters: ['id'], examples: ['desconecte a conta 3'],
  },
  {
    id: 'list_tokens', label: 'Consultar tokens', category: 'integrações', mode: 'read',
    description: 'Lista o estado dos tokens de acesso por plataforma ou status.', parameters: ['platform', 'status'], examples: ['quais tokens estão expirados?'],
  },
  {
    id: 'renew_tokens', label: 'Renovar tokens', category: 'integrações', mode: 'write', confirmation: true,
    description: 'Renova todos os tokens que possuem suporte de renovação.', examples: ['renove meus tokens'],
  },
  {
    id: 'requirements', label: 'Consultar requisitos', category: 'publicações', mode: 'read',
    description: 'Explica mídia, limites e exigências para publicar em cada rede.', parameters: ['platforms'], examples: ['o que o YouTube exige para publicar?'],
  },
  {
    id: 'open_scheduler', label: 'Abrir criador de posts', category: 'publicações', mode: 'read',
    description: 'Abre o criador para preencher mídia, opções da rede e horário de publicação.', examples: ['quero agendar uma publicação'],
  },
]

function getCapability(id) {
  return CAPABILITIES.find(capability => capability.id === id) || null
}

function getCatalogForPrompt() {
  return CAPABILITIES.map(({ id, label, description, mode, confirmation, parameters, examples }) => ({
    id, label, description, mode, confirmation: Boolean(confirmation), parameters: parameters || [], examples: examples || [],
  }))
}

function getPublicCapabilities() {
  return CAPABILITIES.map(capability => ({ ...capability, page: capability.page || null }))
}

module.exports = { APP_PAGES, CAPABILITIES, getCapability, getCatalogForPrompt, getPublicCapabilities }
