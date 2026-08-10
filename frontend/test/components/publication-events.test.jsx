import { findPublicationResult, formatPlatformList, latestPublicationEventId, processingPublicationMessage, scheduledPublicationMessage } from '../../src/lib/publicationEvents.js'

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
      message: 'A publicação não foi concluída no Instagram. instagram (@perfil): Token expirado',
    })
  })

  it('formats publication confirmations with the selected platforms', () => {
    expect(formatPlatformList(['instagram', 'tiktok', 'youtube'])).toBe('Instagram, TikTok e YouTube')
    expect(processingPublicationMessage(['instagram', 'tiktok'])).toBe('Publicação iniciada com sucesso para Instagram e TikTok. Estamos enviando agora e a confirmação aparecerá aqui em instantes.')
  })

  it('includes the scheduled date and time in the confirmation', () => {
    expect(scheduledPublicationMessage('2026-08-10T15:30:00', ['instagram'])).toContain('Publicação agendada com sucesso para')
    expect(scheduledPublicationMessage('2026-08-10T15:30:00', ['instagram'])).toContain('Ela será enviada para Instagram.')
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
