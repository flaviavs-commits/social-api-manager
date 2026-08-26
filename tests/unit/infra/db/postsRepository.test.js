// Testes unitários — postsRepository (pool mockado)
jest.mock('../../../../src/db/pool', () => ({ query: jest.fn() }))

const pool = require('../../../../src/db/pool')
const repo = require('../../../../src/infra/db/postsRepository')

beforeEach(() => jest.clearAllMocks())

// Acha a posição do parâmetro pelo nome da coluna no INSERT em vez de um
// índice fixo — a lista de colunas de posts cresce com frequência (ver
// migrations 029-038) e um índice mágico quebra silenciosamente a cada
// coluna nova inserida antes da que o teste checa.
function indiceDaColuna(query, coluna) {
  const colunas = query.match(/INSERT INTO posts \(([^)]+)\)/)[1].split(',').map(c => c.trim())
  return colunas.indexOf(coluna)
}

const POST = {
  id: 1, text: 'Oi', platforms: ['instagram'], scheduledAt: new Date().toISOString(),
  repeat: 'none', status: 'scheduled', userId: 2, mediaPath: null, mediaType: null,
  mediaItems: null, youtubeTitle: null, youtubeVisibility: 'public', youtubeIsShort: null,
  accountId: null, externalPostId: null, externalPlatform: null, publishedAt: null
}

describe('criarPost', () => {
  test('insere e retorna o post criado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POST] })
    const result = await repo.criarPost({ text: 'Oi', platforms: ['instagram'], scheduledAt: new Date(), userId: 2 })
    expect(result).toEqual(POST)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  test('serializa mediaItems como JSON', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POST] })
    const mediaItems = [{ path: 'a.jpg', type: 'image', caption: '' }]
    await repo.criarPost({ text: 'x', platforms: [], scheduledAt: new Date(), userId: 1, mediaItems })
    const [query, params] = pool.query.mock.calls[0]
    const i = indiceDaColuna(query, 'media_items')
    expect(typeof params[i]).toBe('string')
    expect(JSON.parse(params[i])).toEqual(mediaItems)
  })

  test('mediaItems null permanece null', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POST] })
    await repo.criarPost({ text: 'x', platforms: [], scheduledAt: new Date(), userId: 1 })
    const [query, params] = pool.query.mock.calls[0]
    expect(params[indiceDaColuna(query, 'media_items')]).toBeNull()
  })

  test('serializa textByPlatform como JSON', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POST] })
    const textByPlatform = { instagram: 'texto ig', facebook: 'texto fb' }
    await repo.criarPost({ text: 'x', textByPlatform, platforms: [], scheduledAt: new Date(), userId: 1 })
    const [query, params] = pool.query.mock.calls[0]
    const i = indiceDaColuna(query, 'text_by_platform')
    expect(typeof params[i]).toBe('string')
    expect(JSON.parse(params[i])).toEqual(textByPlatform)
  })

  test('textByPlatform ausente permanece null', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POST] })
    await repo.criarPost({ text: 'x', platforms: [], scheduledAt: new Date(), userId: 1 })
    const [query, params] = pool.query.mock.calls[0]
    expect(params[indiceDaColuna(query, 'text_by_platform')]).toBeNull()
  })
})

describe('listarPosts', () => {
  test('sem filtros retorna todos (isAdmin sem status)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POST] })
    const result = await repo.listarPosts({ isAdmin: true })
    const sql = pool.query.mock.calls[0][0]
    expect(sql).not.toContain('WHERE')
    expect(result[0]).toEqual(POST)
  })

  test('filtra por status para usuário comum', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarPosts({ status: 'scheduled', userId: 2, isAdmin: false })
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('WHERE')
    expect(sql).toContain('status')
    expect(sql).toContain('user_id')
  })

  test('admin com status filtra só por status (sem restrição de user no WHERE)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarPosts({ status: 'published', isAdmin: true })
    const sql = pool.query.mock.calls[0][0]
    const params = pool.query.mock.calls[0][1]
    expect(sql).toContain('status = $1')
    // Não deve passar userId como parâmetro
    expect(params).toHaveLength(1)
    expect(params[0]).toBe('published')
  })
})

describe('buscarPostPorId', () => {
  test('retorna post quando pertence ao usuário', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...POST, userRole: 'user' }] })
    const result = await repo.buscarPostPorId(1, 2, false)
    expect(result).not.toBeNull()
    expect(result.id).toBe(1)
  })

  test('retorna null quando userId não bate', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...POST, userId: 99, userRole: 'user' }] })
    const result = await repo.buscarPostPorId(1, 2, false)
    expect(result).toBeNull()
  })

  test('admin com userId não pode acessar post de outro usuário', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...POST, userId: 99, userRole: 'user' }] })
    const result = await repo.buscarPostPorId(1, 1, true)
    expect(result).toBeNull()
  })

  test('retorna null quando post não existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.buscarPostPorId(999, 1, false)).toBeNull()
  })
})

describe('atualizarStatusPost', () => {
  test('executa UPDATE com status e id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.atualizarStatusPost(1, 'published')
    const sql = pool.query.mock.calls[0][0]
    const params = pool.query.mock.calls[0][1]
    expect(sql).toContain('status = $1::varchar')
    expect(sql).toContain("WHEN $1::varchar = 'published'")
    expect(params).toEqual(['published', null, 1])
  })
})

describe('salvarPublicacaoExterna', () => {
  test('faz upsert em post_publications (uma linha por rede) e preenche as colunas legadas', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    const ts = new Date().toISOString()
    await repo.salvarPublicacaoExterna(1, { externalPostId: 'abc', externalPlatform: 'instagram', publishedAt: ts })

    // 1ª query: upsert em post_publications — params [postId, platform, externalPostId, publishedAt]
    const upsert = pool.query.mock.calls[0]
    expect(upsert[0]).toMatch(/post_publications/)
    expect(upsert[1]).toEqual([1, 'instagram', 'abc', ts])

    // 2ª query: colunas legadas em posts, só se ainda vazias (WHERE external_post_id IS NULL)
    const legacy = pool.query.mock.calls[1]
    expect(legacy[0]).toMatch(/external_post_id IS NULL/)
    expect(legacy[1]).toEqual(['abc', 'instagram', ts, 1])
  })
})

describe('salvarInstagramPending', () => {
  test('serializa estado como JSON', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    const estado = { containerId: 'cid1', tries: 0 }
    await repo.salvarInstagramPending(1, estado)
    const params = pool.query.mock.calls[0][1]
    expect(JSON.parse(params[0])).toEqual(estado)
    expect(params[1]).toBe(1)
  })
})

describe('obterProviderRequestId', () => {
  test('retorna a chave persistida pelo banco', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ providerRequestId: 'request-123' }] })
    await expect(repo.obterProviderRequestId(7)).resolves.toBe('request-123')
    expect(pool.query.mock.calls[0][0]).toContain('COALESCE(provider_request_id')
    expect(pool.query.mock.calls[0][1][0]).toBe(7)
  })
})

describe('registrarSnapshotMetricas', () => {
  test('passa post, rede, likes, comments e views', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.registrarSnapshotMetricas(5, 'instagram', { likes: 100, comments: 10, views: 500 })
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toBe(5)
    expect(params[1]).toBe('instagram')
    expect(params[2]).toBe(100)
    expect(params[3]).toBe(10)
    expect(params[4]).toBe(500)
  })

  test('null para métricas ausentes', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.registrarSnapshotMetricas(5, 'facebook', {})
    const params = pool.query.mock.calls[0][1]
    expect(params[2]).toBeNull()
  })
})

describe('listarPostsCalendario', () => {
  test('filtra por mês e ano', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarPostsCalendario({ year: 2026, month: 7, isAdmin: true })
    const params = pool.query.mock.calls[0][1]
    expect(params[0]).toContain('2026-07-01')
    expect(params[1]).toContain('2026-08-01')
  })

  test('usuário comum inclui filtro de user_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarPostsCalendario({ year: 2026, month: 1, userId: 3, isAdmin: false })
    const params = pool.query.mock.calls[0][1]
    expect(params).toContain(3)
  })
})

describe('reagendarPost', () => {
  test('retorna post atualizado quando encontrado, inclusive se estava em erro', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    const result = await repo.reagendarPost({ id: 1, scheduledAt: new Date(), isAdmin: true })
    expect(result).toEqual({ id: 1 })
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain("status IN ('scheduled', 'agendado', 'error', 'erro', 'failed')")
    expect(sql).toContain('error_message = NULL')
    expect(sql).toContain('publication_error = NULL')
  })

  test('retorna null quando post não existe ou não é do usuário', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.reagendarPost({ id: 99, scheduledAt: new Date(), userId: 1, isAdmin: false })).toBeNull()
  })

  test('admin usa só 2 params; usuário comum usa 3', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    await repo.reagendarPost({ id: 1, scheduledAt: new Date(), isAdmin: true })
    expect(pool.query.mock.calls[0][1]).toHaveLength(2)
    jest.clearAllMocks()
    pool.query.mockResolvedValue({ rows: [] })
    await repo.reagendarPost({ id: 1, scheduledAt: new Date(), userId: 5, isAdmin: false })
    expect(pool.query.mock.calls[0][1]).toHaveLength(3)
  })
})

describe('reservarPostsPendentes', () => {
  test('retorna posts reservados', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, status: 'processing' }] })
    const result = await repo.reservarPostsPendentes()
    expect(result[0].id).toBe(1)
  })

  test('retorna array vazio quando não há posts pendentes', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.reservarPostsPendentes()).toEqual([])
  })
})

describe('listarPostsPublicadosSemExternalId', () => {
  test('filtra por plataforma e user_id para não-admin', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarPostsPublicadosSemExternalId('instagram', 3, false)
    const params = pool.query.mock.calls[0][1]
    expect(params).toContain('instagram')
    expect(params).toContain(3)
  })

  test('admin com userId continua filtrando por user_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listarPostsPublicadosSemExternalId('facebook', 1, true)
    const params = pool.query.mock.calls[0][1]
    expect(params).toEqual(['facebook', 1])
  })
})

describe('limparInstagramPending', () => {
  test('executa UPDATE instagram_pending = NULL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.limparInstagramPending(5)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('instagram_pending = NULL')
    expect(pool.query.mock.calls[0][1]).toEqual([5])
  })
})

describe('listarPostsComInstagramPendente', () => {
  test('retorna posts com instagram_pending não nulo', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, instagramPending: '{}' }] })
    const result = await repo.listarPostsComInstagramPendente()
    expect(result[0].id).toBe(1)
  })
})

describe('buscarHistoricoMetricas', () => {
  test('retorna histórico por postId', async () => {
    const rows = [{ date: '2026-07-01', likes: 50 }]
    pool.query.mockResolvedValueOnce({ rows })
    const result = await repo.buscarHistoricoMetricas(1)
    expect(result).toEqual(rows)
    expect(pool.query.mock.calls[0][1]).toEqual([1])
  })
})

describe('definirAccountIdSeVazio', () => {
  test('executa UPDATE account_id onde ainda é NULL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    await repo.definirAccountIdSeVazio(1, 42)
    const sql = pool.query.mock.calls[0][0]
    expect(sql).toContain('account_id IS NULL')
    expect(pool.query.mock.calls[0][1]).toEqual([42, 1])
  })
})

describe('deletarPost', () => {
  test('cancela post scheduled e retorna true', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...POST, userRole: 'user' }] }) // buscarPostPorId
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
    expect(await repo.deletarPost(1, 2, false)).toBe(true)
  })

  test('retorna false quando post não pertence ao usuário', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }) // buscarPostPorId → null
    expect(await repo.deletarPost(1, 99, false)).toBe(false)
  })

  test('retorna false quando UPDATE não afeta linhas (status != scheduled)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...POST, userRole: 'user' }] })
      .mockResolvedValueOnce({ rowCount: 0 })
    expect(await repo.deletarPost(1, 2, false)).toBe(false)
  })
})
