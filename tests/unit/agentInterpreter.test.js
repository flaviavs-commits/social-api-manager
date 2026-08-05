const {
  interpretWithRules,
  interpretAgentMessage,
  completePendingPlan,
  parseModelPlan,
} = require('../../src/services/ai/agentInterpreter')

describe('agente operacional — interpretação de pedidos', () => {
  test('identifica consulta de calendário com mês relativo', () => {
    const plan = interpretWithRules('o que tenho agendado no próximo mês?', 'dashboard')

    expect(plan.actionId).toBe('calendar')
    expect(plan.arguments.month).toBe(new Date().getMonth() === 11 ? 1 : new Date().getMonth() + 2)
  })

  test('exige confirmação antes de criar rascunho', () => {
    const plan = interpretWithRules('salve como rascunho: campanha de inverno', 'rascunhos')

    expect(plan.actionId).toBe('create_draft')
    expect(plan.requiresConfirmation).toBe(true)
    expect(plan.arguments.text).toContain('campanha de inverno')
  })

  test('identifica geração de conteúdo e preserva a plataforma', () => {
    const plan = interpretWithRules('crie um post profissional sobre academia para o TikTok', 'ai')

    expect(plan.actionId).toBe('generate_posts')
    expect(plan.arguments.platforms).toEqual(['tiktok'])
    expect(plan.arguments.tone).toBe('profissional')
  })

  test('prioriza analytics quando o pedido consulta métricas das redes conectadas', () => {
    const plan = interpretWithRules('eu quero o analytics das redes sociais conectadas na aplicação, todas as informações', 'ai')

    expect(plan.actionId).toBe('analytics')
  })

  test('transforma pedido de análise em insight estratégico', () => {
    const plan = interpretWithRules('analise minhas métricas e diga o que devo melhorar', 'analytics')

    expect(plan.actionId).toBe('analytics_insight')
  })

  test('não confunde analytics citado no conteúdo com consulta de métricas', () => {
    const plan = interpretWithRules('crie um post sobre analytics para o Instagram', 'ai')

    expect(plan.actionId).toBe('generate_posts')
    expect(plan.arguments.platforms).toEqual(['instagram'])
  })

  test('não aceita ação inventada pelo modelo', () => {
    expect(() => parseModelPlan('{"actionId":"apagar_banco","arguments":{}}')).toThrow(/não existe no catálogo/)
  })

  test('retorna ajuda para pedido sem intenção reconhecida', () => {
    const plan = interpretWithRules('faça algo incrível para mim', 'dashboard')

    expect(plan.actionId).toBe('unknown')
    expect(plan.answer).toMatch(/funções disponíveis|conversar/i)
  })

  test('interpreta reagendamento com data relativa e exige confirmação', () => {
    const plan = interpretWithRules('reagende o post 42 para amanhã às 10h', 'calendario')

    expect(plan.actionId).toBe('reschedule_post')
    expect(plan.arguments.postId).toBe(42)
    expect(new Date(plan.arguments.scheduledAt).getHours()).toBe(10)
    expect(new Date(plan.arguments.scheduledAt).getMinutes()).toBe(0)
    expect(plan.requiresConfirmation).toBe(true)
  })

  test('prioriza histórico de métricas em vez de navegação para analytics', () => {
    const plan = interpretWithRules('mostre o histórico de métricas do post 42', 'ai')

    expect(plan.actionId).toBe('metrics_history')
    expect(plan.arguments.postId).toBe(42)
  })

  test('interpreta ações de inbox e textos salvos', () => {
    expect(interpretWithRules('marque os comentários do post 42 como vistos', 'inbox').actionId).toBe('mark_comments_seen')
    expect(interpretWithRules('tenho comentários não lidos?', 'inbox').actionId).toBe('unread_inbox')
    const plan = interpretWithRules('salve este texto para usar depois: bom dia, comunidade', 'ai')
    expect(plan.actionId).toBe('save_text')
    expect(plan.arguments.body).toBe('bom dia, comunidade')
  })

  test('permite conversa estratégica e usa a resposta do modelo', async () => {
    const plan = interpretWithRules('como posso crescer no Instagram sem gastar com anúncios?', 'ai')
    expect(plan.actionId).toBe('conversation')

    const result = await interpretAgentMessage({
      message: 'como posso crescer no Instagram sem gastar com anúncios?',
      currentPage: 'ai',
      generateText: async prompt => {
        expect(prompt).toMatch(/estratégia|estrategia/i)
        return JSON.stringify({
          actionId: 'conversation',
          arguments: { topic: 'crescimento orgânico' },
          answer: 'Comece definindo um público específico e publique séries de conteúdo úteis.',
          confidence: 0.94,
        })
      },
    })

    expect(result.actionId).toBe('conversation')
    expect(result.answer).toMatch(/público específico/)
  })

  test('preenche um plano pendente a partir da resposta seguinte', () => {
    const plan = completePendingPlan('42 amanhã às 10h', {
      actionId: 'reschedule_post',
      arguments: { postId: null, scheduledAt: null },
      missingFields: ['postId', 'scheduledAt'],
      requiresConfirmation: true,
    })

    expect(plan.missingFields).toEqual([])
    expect(plan.arguments.postId).toBe(42)
    expect(new Date(plan.arguments.scheduledAt).getHours()).toBe(10)
  })
})
