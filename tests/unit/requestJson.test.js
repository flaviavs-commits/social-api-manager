const { HttpClientError, requestJson } = require('../../src/infra/http/requestJson')

function response({ status = 200, body = {}, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body))
  }
}

describe('requestJson', () => {
  test('envia query/body JSON e retorna o payload', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ body: { ok: true } }))
    const result = await requestJson('https://api.test/items', {
      method: 'POST', query: { page: 2 }, body: { name: 'item' }, fetchImpl, retries: 0
    })

    expect(result).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledWith(expect.objectContaining({ href: 'https://api.test/items?page=2' }), expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'item' }),
      headers: expect.objectContaining({ 'Content-Type': 'application/json' })
    }))
  })

  test('repete falhas transitórias e respeita o limite de tentativas', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ status: 503, body: { error: 'indisponível' } }))
      .mockResolvedValueOnce(response({ body: { ok: true } }))
    await expect(requestJson('https://api.test', { fetchImpl, retries: 1, retryDelayMs: 0 })).resolves.toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  test('expõe erro estruturado para falha não recuperável', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ status: 401, body: { error: 'Não autorizado' } }))
    await expect(requestJson('https://api.test', { fetchImpl, retries: 0 })).rejects.toMatchObject({
      constructor: HttpClientError, status: 401, message: 'Não autorizado'
    })
  })
})
