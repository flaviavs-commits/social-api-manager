import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, publicApiFetch } from '../../src/lib/api.js'

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: vi.fn().mockResolvedValue(JSON.stringify(body)) }
}

describe('api client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('envia token e interpreta JSON', async () => {
    localStorage.setItem('authToken', 'session-token')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/api/me', { method: 'POST', body: JSON.stringify({ name: 'Ana' }) })).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({
      method: 'POST', signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: 'Bearer session-token', 'Content-Type': 'application/json' })
    }))
  })

  it('converte resposta de erro não-JSON em ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, text: vi.fn().mockResolvedValue('Gateway indisponível') }))
    await expect(publicApiFetch('/api/config')).rejects.toMatchObject({ constructor: ApiError, status: 502, message: 'Gateway indisponível' })
  })

  it('converte abort/timeout em erro de rede controlado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    await expect(publicApiFetch('/api/config', { timeoutMs: 1 })).rejects.toMatchObject({ status: 408 })
  })
})
