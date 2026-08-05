const {
  interpretWithRules,
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
    expect(plan.answer).toMatch(/funções disponíveis/i)
  })
})
