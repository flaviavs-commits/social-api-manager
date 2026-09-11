// Testes unitários — usersRepository (pool mockado)
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)

jest.mock('../../src/db/pool', () => ({ query: jest.fn() }))

const pool = require('../../src/db/pool')
const repo = require('../../src/repositories/usersRepository')

beforeEach(() => jest.clearAllMocks())

describe('buscarPorEmail', () => {
  test('retorna usuário quando encontrado', async () => {
    const user = { id: 1, email: 'a@b.com', role: 'user' }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    const result = await repo.buscarPorEmail('a@b.com')
    expect(result).toEqual(user)
  })

  test('retorna null quando não encontrado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    const result = await repo.buscarPorEmail('nao@existe.com')
    expect(result).toBeNull()
  })

  test('normaliza o email (trim + lowercase)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.buscarPorEmail('  A@B.COM  ')
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['a@b.com'])
  })
})

describe('buscarPorId', () => {
  test('retorna usuário pelo id', async () => {
    const user = { id: 5, email: 'x@y.com' }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    expect(await repo.buscarPorId(5)).toEqual(user)
  })

  test('retorna null quando não encontrado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorId(999)).toBeNull()
  })
})

describe('criar', () => {
  test('insere e retorna o usuário criado', async () => {
    const user = { id: 2, email: 'novo@x.com', fullName: 'Novo' }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    const result = await repo.criar({ email: 'novo@x.com', fullName: 'Novo' })
    expect(result).toEqual(user)
  })

  test('passa fullName null quando omitido', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3 }] })
    await repo.criar({ email: 'x@y.com' })
    const params = pool.query.mock.calls[0][1]
    expect(params[1]).toBeNull()
  })

  test('cria com plan_active=FALSE por padrão (cadastro normal, aguarda pagamento)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 4 }] })
    await repo.criar({ email: 'cliente@x.com' })
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('plan_active')
    expect(params).toEqual(['cliente@x.com', null, 'basico', false, ['instagram', 'youtube', 'tiktok', 'facebook']])
  })

  test('cria com plan_active=TRUE quando planActive é passado (conta interna isenta)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] })
    await repo.criar({ email: 'interno@vitissouls.com', planActive: true })
    const params = pool.query.mock.calls[0][1]
    expect(params[3]).toBe(true)
  })
})

describe('criarComGoogle', () => {
  test('devolve planActive no RETURNING (evita a inconsistência do redirect pós-cadastro)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 6, email: 'g@x.com', fullName: 'G', planActive: false }] })
    const result = await repo.criarComGoogle({ email: 'g@x.com', fullName: 'G', googleId: 'goog_1' })
    expect(result.planActive).toBe(false)
    const [sql] = pool.query.mock.calls[0]
    expect(sql).toContain('plan_active AS "planActive"')
  })

  test('cria com plan_active=TRUE quando planActive é passado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7 }] })
    await repo.criarComGoogle({ email: 'interno@vitissouls.com', googleId: 'goog_2', planActive: true })
    const params = pool.query.mock.calls[0][1]
    expect(params[4]).toBe(true)
  })
})

describe('atualizarRole', () => {
  test('retorna usuário atualizado', async () => {
    const user = { id: 1, email: 'a@b.com', role: 'admin' }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    expect(await repo.atualizarRole(1, 'admin')).toEqual(user)
  })

  test('retorna null quando id não existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.atualizarRole(999, 'admin')).toBeNull()
  })
})

describe('atualizarAtivo', () => {
  test('retorna usuário com ativo atualizado', async () => {
    const user = { id: 1, email: 'a@b.com', ativo: false }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    expect(await repo.atualizarAtivo(1, false)).toEqual(user)
  })
})

describe('listarTodos', () => {
  test('converte totalContas para Number', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, email: 'a@b.com', totalContas: '3' }] })
    const result = await repo.listarTodos(1)
    expect(result[0].totalContas).toBe(3)
    expect(typeof result[0].totalContas).toBe('number')
  })
})

describe('obterMetricasAgregadas', () => {
  test('devolve só números agregados, sem nenhum dado individual', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ plan: 'basico', total: '3' }, { plan: 'pro', total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ ativo: true, total: '3' }, { ativo: false, total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total: '4' }] })

    const metrics = await repo.obterMetricasAgregadas()

    expect(metrics).toEqual({
      totalUsuarios: 4,
      porPlano: { basico: 3, pro: 1 },
      ativos: 3,
      desativados: 1,
    })
    // Confere que nenhuma das 3 queries seleciona colunas de identificação.
    for (const [sql] of pool.query.mock.calls) {
      expect(sql).not.toMatch(/\bemail\b|\bid\b|full_name/i)
    }
  })

  test('zera quando a base está vazia', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })

    expect(await repo.obterMetricasAgregadas()).toEqual({ totalUsuarios: 0, porPlano: {}, ativos: 0, desativados: 0 })
  })
})

describe('salvarStripeCustomerId / buscarPorStripeCustomerId', () => {
  test('salva o customer id e devolve a linha atualizada', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7, stripeCustomerId: 'cus_123' }] })

    const result = await repo.salvarStripeCustomerId(7, 'cus_123')

    expect(result).toEqual({ id: 7, stripeCustomerId: 'cus_123' })
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['cus_123', 7])
  })

  test('busca o usuário pelo customer id, só entre contas ativas', async () => {
    const user = { id: 7, email: 'cliente@allowed.test' }
    pool.query.mockResolvedValueOnce({ rows: [user] })

    const result = await repo.buscarPorStripeCustomerId('cus_123')

    expect(result).toEqual(user)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('ativo = TRUE')
    expect(params).toEqual(['cus_123'])
  })

  test('devolve null quando não encontra', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorStripeCustomerId('cus_inexistente')).toBeNull()
  })
})

describe('contarAdmins', () => {
  test('retorna número de admins', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ total: '2' }] })
    expect(await repo.contarAdmins()).toBe(2)
  })
})

describe('buscarPorIdIncluindoInativo', () => {
  test('retorna usuário mesmo inativo', async () => {
    const user = { id: 1, email: 'a@b.com', ativo: false }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    expect(await repo.buscarPorIdIncluindoInativo(1)).toEqual(user)
  })
  test('retorna null quando não existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorIdIncluindoInativo(999)).toBeNull()
  })
})

describe('buscarPorGoogleId', () => {
  test('retorna usuário pelo google_id', async () => {
    const user = { id: 1, google_id: 'g123' }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    expect(await repo.buscarPorGoogleId('g123')).toEqual(user)
  })
  test('retorna null quando não encontrado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPorGoogleId('nao-existe')).toBeNull()
  })
})

describe('criarComGoogle', () => {
  test('insere com google_id e retorna usuário', async () => {
    const user = { id: 3, email: 'g@g.com', fullName: 'Google' }
    pool.query.mockResolvedValueOnce({ rows: [user] })
    expect(await repo.criarComGoogle({ email: 'g@g.com', fullName: 'Google', googleId: 'gid1' })).toEqual(user)
  })
})

describe('vincularGoogleId', () => {
  test('executa UPDATE com googleId e userId', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.vincularGoogleId(1, 'gid123')
    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE/), ['gid123', 1])
  })
})

describe('perfil de conexão', () => {
  test('busca o profileId do usuário', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ zernioProfileId: 'profile-1' }] })
    expect(await repo.buscarZernioProfileId(1)).toBe('profile-1')
  })

  test('salva o profileId do usuário', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ zernioProfileId: 'profile-1' }] })
    expect(await repo.salvarZernioProfileId(1, 'profile-1')).toBe('profile-1')
    expect(pool.query.mock.calls[0][1]).toEqual(['profile-1', 1])
  })
})

describe('ativarTotp / desativarTotp', () => {
  test('ativarTotp executa UPDATE totp_enabled = TRUE', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.ativarTotp(1)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('totp_enabled = TRUE')
  })
  test('desativarTotp executa UPDATE totp_secret = NULL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.desativarTotp(1)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('totp_secret = NULL')
  })
})

describe('atualizarAvatar', () => {
  test('retorna usuário com avatarUrl', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, avatarUrl: 'https://blob.example.com/img.jpg' }] })
    const result = await repo.atualizarAvatar(1, 'https://blob.example.com/img.jpg')
    expect(result.avatarUrl).toBeTruthy()
  })
  test('retorna null quando usuário não existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.atualizarAvatar(999, 'url')).toBeNull()
  })
})

describe('contarSuperAdmins', () => {
  test('retorna número de super_admins', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ total: '1' }] })
    expect(await repo.contarSuperAdmins()).toBe(1)
  })
})

describe('listarEmailsAdmins', () => {
  test('retorna só os e-mails de admin/super_admin ativos', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ email: 'brenoaugusto@vitissouls.com' }, { email: 'tiago@vitissouls.com' }] })

    const emails = await repo.listarEmailsAdmins()

    expect(emails).toEqual(['brenoaugusto@vitissouls.com', 'tiago@vitissouls.com'])
    const [sql] = pool.query.mock.calls[0]
    expect(sql).toContain("role IN ('admin', 'super_admin')")
    expect(sql).toContain('ativo = TRUE')
  })

  test('retorna array vazio quando não há admin', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.listarEmailsAdmins()).toEqual([])
  })
})

describe('salvarSegredoTotp / buscarTotp', () => {
  test('salvarSegredoTotp cifra o segredo antes de gravar', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.salvarSegredoTotp(1, 'MEUSEGREDOBASE32')
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toMatch(/^enc:v1:/)
  })

  test('buscarTotp decifra o segredo retornado pelo banco', async () => {
    const { encrypt } = require('../../src/services/tokenCrypto')
    const cifrado = encrypt('MEUSEGREDOBASE32')
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, totp_secret: cifrado, totp_enabled: true }] })
    const result = await repo.buscarTotp(1)
    expect(result.secret).toBe('MEUSEGREDOBASE32')
    expect(result.enabled).toBe(true)
  })

  test('buscarTotp retorna null quando usuário não existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarTotp(99)).toBeNull()
  })
})
