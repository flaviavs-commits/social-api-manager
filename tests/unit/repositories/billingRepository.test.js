// Testes unitários — billingRepository.confirmarPagamentoDireto
//
// Confirma o contrato transacional do vínculo feito por Payment Link direto:
// idempotência por gateway_session_id, ativação do plano e recusa de
// sobrescrever uma cobrança já registrada no mês.
jest.mock('../../../src/db/pool', () => ({ query: jest.fn(), connect: jest.fn() }))

const pool = require('../../../src/db/pool')
const repo = require('../../../src/repositories/billingRepository')

let client

function linha(overrides = {}) {
  return {
    id: 99,
    userId: 7,
    fromPlan: 'basico',
    toPlan: 'pro',
    amountCents: 10050,
    currency: 'brl',
    billingMonth: '2026-09-01',
    gatewaySessionId: 'cs_link',
    status: 'paid',
    ...overrides,
  }
}

const entrada = {
  userId: 7,
  fromPlan: 'basico',
  toPlan: 'pro',
  amountCents: 10050,
  currency: 'brl',
  billingMonth: '2026-09-01',
  gatewaySessionId: 'cs_link',
  gatewayPaymentId: 'pi_link',
}

function sqlDasChamadas() {
  return client.query.mock.calls.map(([sql]) => String(sql).trim())
}

beforeEach(() => {
  jest.clearAllMocks()
  client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }
  pool.connect.mockResolvedValue(client)
  pool.query.mockResolvedValue({ rows: [] })
})

describe('buscarPorGatewaySessions', () => {
  test('consulta em lote com ANY($1) e devolve as linhas', async () => {
    const rows = [linha({ gatewaySessionId: 'cs_1' }), linha({ gatewaySessionId: 'cs_2' })]
    pool.query.mockResolvedValue({ rows })

    const resultado = await repo.buscarPorGatewaySessions(['cs_1', 'cs_2'])

    expect(resultado).toEqual(rows)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('ANY($1::text[])')
    expect(params).toEqual([['cs_1', 'cs_2']])
  })

  test('devolve array vazio sem consultar o banco quando a lista está vazia', async () => {
    const resultado = await repo.buscarPorGatewaySessions([])

    expect(resultado).toEqual([])
    expect(pool.query).not.toHaveBeenCalled()
  })

  test('devolve array vazio para entrada que não é array', async () => {
    expect(await repo.buscarPorGatewaySessions(null)).toEqual([])
    expect(await repo.buscarPorGatewaySessions(undefined)).toEqual([])
  })
})

describe('confirmarPagamentoDireto', () => {
  test('cria a cobrança paga e ativa o plano do usuário na mesma transação', async () => {
    const criada = linha()
    client.query
      .mockResolvedValueOnce({ rows: [] })        // BEGIN
      .mockResolvedValueOnce({ rows: [] })        // SELECT ... FOR UPDATE (nada ainda)
      .mockResolvedValueOnce({ rows: [criada] })  // INSERT
      .mockResolvedValueOnce({ rows: [] })        // UPDATE users
      .mockResolvedValueOnce({ rows: [] })        // COMMIT

    const resultado = await repo.confirmarPagamentoDireto(entrada)

    expect(resultado).toEqual(criada)

    const sqls = sqlDasChamadas()
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[sqls.length - 1]).toBe('COMMIT')
    expect(sqls.some(sql => sql.startsWith('ROLLBACK'))).toBe(false)

    const updateUsers = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE users'))
    expect(updateUsers[0]).toMatch(/plan_active = TRUE/)
    expect(updateUsers[1]).toEqual(['pro', 7])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('grava a sessão do gateway e uma chave de idempotência derivada dela', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [linha()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await repo.confirmarPagamentoDireto(entrada)

    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO billing_plan_changes'))
    expect(insert[0]).toMatch(/'paid'/)
    expect(insert[0]).toMatch(/ON CONFLICT \(user_id, billing_month\) DO NOTHING/)
    expect(insert[1]).toEqual(expect.arrayContaining(['direct-link-cs_link', 'cs_link', 'pi_link']))
  })

  test('reentrega do webhook devolve a cobrança já paga sem inserir de novo', async () => {
    const existente = linha({ status: 'paid' })
    client.query
      .mockResolvedValueOnce({ rows: [] })          // BEGIN
      .mockResolvedValueOnce({ rows: [existente] }) // SELECT ... FOR UPDATE encontra
      .mockResolvedValueOnce({ rows: [] })          // COMMIT

    const resultado = await repo.confirmarPagamentoDireto(entrada)

    expect(resultado).toEqual(existente)
    expect(sqlDasChamadas().some(sql => sql.includes('INSERT INTO billing_plan_changes'))).toBe(false)
    expect(sqlDasChamadas().some(sql => sql.includes('UPDATE users'))).toBe(false)
    expect(sqlDasChamadas()).toContain('COMMIT')
  })

  test('não sobrescreve a cobrança do mês criada pelo fluxo normal do app', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rows: [] })  // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [] })  // INSERT barrado pelo ON CONFLICT
      .mockResolvedValueOnce({ rows: [] })  // ROLLBACK

    const resultado = await repo.confirmarPagamentoDireto(entrada)

    expect(resultado).toBeNull()
    expect(sqlDasChamadas()).toContain('ROLLBACK')
    expect(sqlDasChamadas().some(sql => sql.includes('UPDATE users'))).toBe(false)
    expect(sqlDasChamadas()).not.toContain('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('faz rollback e devolve a conexão quando o banco falha', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('conexão perdida'))
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

    await expect(repo.confirmarPagamentoDireto(entrada)).rejects.toThrow('conexão perdida')

    expect(sqlDasChamadas()).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('só ativa o plano de conta ativa', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [linha()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await repo.confirmarPagamentoDireto(entrada)

    const updateUsers = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE users'))
    expect(updateUsers[0]).toMatch(/ativo = TRUE/)
  })
})

describe('confirmarPagamento — divergência de valor/plano', () => {
  // A task "impedir que divergência de valor derrube o webhook com 500
  // permanente" (10/09/2026) depende deste contrato: o erro precisa ter um
  // .code que billingService.handleWebhook reconheça, para tratar como
  // reconciliação em vez de deixar subir como 500 genérico.
  const registroPago = linha({ amountCents: 10050, currency: 'brl', toPlan: 'pro', status: 'processing' })

  test('valor divergente lança erro com code amount_mismatch e faz ROLLBACK', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })               // BEGIN
      .mockResolvedValueOnce({ rows: [registroPago] })    // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [] })                // ROLLBACK

    await expect(repo.confirmarPagamento({
      gatewaySessionId: 'cs_link',
      gatewayPaymentId: 'pi_link',
      amountCents: 10099, // diferente do registrado (10050)
      currency: 'brl',
      toPlan: 'pro',
    })).rejects.toMatchObject({ code: 'amount_mismatch' })

    expect(sqlDasChamadas()).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('plano divergente lança erro com code plan_mismatch', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [registroPago] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(repo.confirmarPagamento({
      gatewaySessionId: 'cs_link',
      gatewayPaymentId: 'pi_link',
      amountCents: 10050,
      currency: 'brl',
      toPlan: 'premium', // diferente do registrado (pro)
    })).rejects.toMatchObject({ code: 'plan_mismatch' })
  })
})
