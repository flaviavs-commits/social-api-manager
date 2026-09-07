import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('mantém a resposta feita pela aplicação enquanto a rede ainda sincroniza', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/posts/42/comments') return Promise.resolve({
        comments: [{ id: 'comment-1', author: 'Ana', text: 'Comentário original', createdAt: '2026-09-07T12:00:00Z' }],
        post: { id: 42, platform: 'instagram', replySupported: true }
      })
      if (path === '/api/saved-texts') return Promise.resolve({ savedTexts: [] })
      return Promise.resolve({})
    })

    render(<CommentsModal embedded postId={42} initialPost={{ id: 42, platform: 'instagram', text: 'Meu post', replySupported: true }} />)

    const replyInput = await screen.findByPlaceholderText('Responder este comentário...')
    fireEvent.change(replyInput, { target: { value: 'Minha resposta pela aplicação' } })
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }))

    await waitFor(() => expect(screen.getByText('Minha resposta pela aplicação')).toBeInTheDocument())
    expect(apiFetchMock).toHaveBeenCalledWith('/api/posts/42/comments/comment-1/reply', expect.objectContaining({ method: 'POST' }))
  })

  it('renderiza a resposta dentro do comentário original', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/posts/42/comments') return Promise.resolve({
        comments: [
          { id: 'comment-1', author: 'Ana', text: 'Comentário original', createdAt: '2026-09-07T12:00:00Z' },
          { id: 'reply-1', author: 'Breno', text: 'Resposta sincronizada', parentId: 'comment-1', createdAt: '2026-09-07T12:01:00Z' }
        ],
        post: { id: 42, platform: 'instagram', replySupported: true }
      })
      if (path === '/api/saved-texts') return Promise.resolve({ savedTexts: [] })
      return Promise.resolve({})
    })

    render(<CommentsModal embedded postId={42} initialPost={{ id: 42, platform: 'instagram', text: 'Meu post', replySupported: true }} />)

    const reply = await screen.findByText('Resposta sincronizada', { selector: '.comment-text' })
    expect(reply.closest('.comment-replies')).toBeInTheDocument()
    expect(reply.closest('.comment-row-nested')).toBeInTheDocument()
  })
})
