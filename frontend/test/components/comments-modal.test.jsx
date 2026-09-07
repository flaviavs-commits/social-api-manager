import { act, render, screen } from '@testing-library/react'
import { CommentsModal } from '../../src/components/analytics/comments-modal.jsx'
import * as api from '../../src/lib/api.js'

describe('CommentsModal', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('continua consultando quando o comentário recém-feito ainda não foi sincronizado', async () => {
    vi.useFakeTimers()
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/posts/42/comments') {
        return Promise.resolve(apiFetchMock.mock.calls.filter(([calledPath]) => calledPath === path).length === 1
          ? { comments: [], post: { id: 42, platform: 'instagram' } }
          : { comments: [{ id: 'comment-1', author: 'Ana', text: 'Comentário recém-publicado', createdAt: '2026-09-07T12:00:00Z' }], post: { id: 42, platform: 'instagram' } })
      }
      if (path === '/api/saved-texts') return Promise.resolve({ savedTexts: [] })
      return Promise.resolve({})
    })

    render(<CommentsModal embedded postId={42} initialPost={{ id: 42, platform: 'instagram', text: 'Meu post' }} />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('status')).toHaveTextContent('Aguardando a sincronização')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(apiFetchMock.mock.calls.filter(([path]) => path === '/api/posts/42/comments')).toHaveLength(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(55_000) })
    expect(screen.getByText('Comentário recém-publicado')).toBeInTheDocument()
    expect(apiFetchMock.mock.calls.filter(([path]) => path === '/api/posts/42/comments')).toHaveLength(2)
  })
})
