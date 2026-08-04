import { findPublicationResult, latestPublicationEventId } from '../../src/lib/publicationEvents.js'

describe('publication events', () => {
  it('shows the platform error returned after an asynchronous publication', () => {
    const result = findPublicationResult([{
      id: 18,
      event_name: 'post_published',
      payload: {
        id: 42,
        status: 'error',
        results: [{ platform: 'instagram', account: '@perfil', success: false, error: 'Token expirado' }],
      },
    }], 42)

    expect(result).toEqual({
      type: 'error',
      message: 'Não foi possível publicar o post #42. instagram (@perfil): Token expirado',
    })
  })

  it('ignores publication events from another post', () => {
    const result = findPublicationResult([{
      id: 19,
      event_name: 'post_published',
      payload: { id: 99, status: 'error', results: [] },
    }], 42)

    expect(result).toBeNull()
  })

  it('drains full event pages and returns the latest cursor', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: index + 1 }))
    const apiFetch = vi.fn()
      .mockResolvedValueOnce({ events: firstPage })
      .mockResolvedValueOnce({ events: [{ id: 201 }, { id: 202 }] })

    await expect(latestPublicationEventId(apiFetch)).resolves.toBe(202)
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/logs/events/since/0')
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/logs/events/since/200')
  })
})
