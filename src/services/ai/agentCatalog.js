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
    id: 'dashboard_summary', label: 'Resumo do painel', category: 'painel', mode: 'read',
    description: 'Mostra um resumo das contas conectadas e do estado dos tokens.', examples: ['como está meu painel?', 'quantas contas estão ativas?'],
  },
  {
    id: 'post_details', label: 'Detalhes da publicação', category: 'publicações', mode: 'read',
    description: 'Carrega uma publicação específica pelo ID.', parameters: ['postId'], examples: ['mostre os detalhes do post 42'],
  },
  {
    id: 'metrics_history', label: 'Histórico de métricas', category: 'desempenho', mode: 'read',
    description: 'Consulta a evolução das métricas de uma publicação.', parameters: ['postId'], examples: ['mostre o histórico do post 42'],
  },
  {
    id: 'reschedule_post', label: 'Reagendar publicação', category: 'publicações', mode: 'write', confirmation: true,
    description: 'Altera o horário de uma publicação ainda agendada.', parameters: ['postId', 'scheduledAt'], examples: ['reagende o post 42 para amanhã às 10h'],
  },
  {
    id: 'cancel_post', label: 'Cancelar publicação', category: 'publicações', mode: 'write', confirmation: true,
    description: 'Cancela uma publicação que ainda não foi publicada.', parameters: ['postId'], examples: ['cancele o post 42'],
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
    id: 'unread_inbox', label: 'Consultar não lidos', category: 'relacionamento', mode: 'read',
    description: 'Conta comentários novos que ainda não foram vistos.', examples: ['tenho comentários não lidos?'],
  },
  {
    id: 'mark_comments_seen', label: 'Marcar comentários como vistos', category: 'relacionamento', mode: 'write', confirmation: true,
    description: 'Marca os comentários de uma publicação como vistos.', parameters: ['postId', 'commentIds'], examples: ['marque os comentários do post 42 como vistos'],
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
    id: 'tiktok_videos', label: 'Listar vídeos do TikTok', category: 'desempenho', mode: 'read',
    description: 'Lista os vídeos recentes das contas TikTok conectadas.', examples: ['mostre meus vídeos do TikTok'],
  },
  {
    id: 'tiktok_creator_info', label: 'Consultar opções do TikTok', category: 'publicações', mode: 'read',
    description: 'Consulta as opções de publicação disponíveis no TikTok.', parameters: ['accountId'], examples: ['quais opções tenho para publicar no TikTok?'],
  },
  {
    id: 'list_saved_texts', label: 'Listar textos salvos', category: 'conteúdo', mode: 'read',
    description: 'Lista textos reutilizáveis salvos pelo usuário.', examples: ['mostre meus textos salvos'],
  },
  {
    id: 'save_text', label: 'Salvar texto reutilizável', category: 'conteúdo', mode: 'write', confirmation: true,
    description: 'Salva um texto para reutilização em publicações futuras.', parameters: ['title', 'body'], examples: ['salve este texto para usar depois: bom dia, comunidade'],
  },
  {
    id: 'delete_saved_text', label: 'Excluir texto salvo', category: 'conteúdo', mode: 'write', confirmation: true,
    description: 'Exclui um texto salvo identificado pelo ID.', parameters: ['id'], examples: ['exclua o texto salvo 3'],
  },
  {
    id: 'list_presets', label: 'Listar presets', category: 'publicações', mode: 'read',
    description: 'Lista configurações de publicação salvas por rede.', parameters: ['platform'], examples: ['quais presets de publicação eu tenho?'],
  },
  {
    id: 'save_preset', label: 'Salvar preset', category: 'publicações', mode: 'write', confirmation: true,
    description: 'Salva um preset de configurações para uma rede.', parameters: ['platform', 'name', 'config'], examples: ['salve um preset público para o TikTok'],
  },
  {
    id: 'delete_preset', label: 'Excluir preset', category: 'publicações', mode: 'write', confirmation: true,
    description: 'Exclui um preset identificado pelo ID.', parameters: ['id'], examples: ['exclua o preset 3'],
  },
  {
    id: 'platform_health', label: 'Saúde das plataformas', category: 'integrações', mode: 'read',
    description: 'Mostra o último status conhecido de disponibilidade das redes.', examples: ['as redes estão funcionando?'],
  },
  {
    id: 'list_logs', label: 'Consultar histórico de atividades', category: 'sistema', mode: 'read',
    description: 'Lista atividades recentes visíveis para o usuário.', parameters: ['limit'], examples: ['mostre os últimos erros'],
  },
  {
    id: 'list_memories', label: 'Consultar memórias da IA', category: 'assistente', mode: 'read',
    description: 'Lista preferências, ideias e lembretes salvos para a IA.', parameters: ['model'], examples: ['o que você lembra sobre mim?'],
  },
  {
    id: 'save_memory', label: 'Salvar memória da IA', category: 'assistente', mode: 'write', confirmation: true,
    description: 'Salva uma preferência, ideia ou lembrete para conversas futuras.', parameters: ['content', 'type', 'model'], examples: ['lembre que prefiro tom profissional'],
  },
  {
    id: 'resolve_memory', label: 'Resolver memória da IA', category: 'assistente', mode: 'write', confirmation: true,
    description: 'Marca uma memória como resolvida.', parameters: ['id'], examples: ['marque a memória 4 como resolvida'],
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
