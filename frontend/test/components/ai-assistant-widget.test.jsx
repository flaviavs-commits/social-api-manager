import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AiAssistantWidget } from '../../src/components/ai/ai-assistant-widget.jsx'
import * as api from '../../src/lib/api.js'

describe('AiAssistantWidget', () => {
  afterEach(() => vi.restoreAllMocks())

  it('starts closed and does not render the panel', () => {
    render(<AiAssistantWidget />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir assistente de IA' })).toBeInTheDocument()
  })

  it('renders nothing at all when hidden (e.g. on the AI page itself)', () => {
    const { container } = render(<AiAssistantWidget hidden />)
    expect(container.firstChild).toBeNull()
  })

  it('opens the chat panel on click and closes on Escape', () => {
    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))
    expect(screen.getByRole('dialog', { name: 'Assistente de IA' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends a message, shows the reply, and persists both turns without blocking on the persist call', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path, options = {}) => {
      if (path === '/api/ai/generate') return Promise.resolve({ posts: [{ text: 'Ideia gerada pela IA' }] })
      if (path === '/api/ai/chat-messages') return Promise.resolve({ ok: true })
      return Promise.reject(new Error(`unexpected call to ${path}`))
    })

    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))
    fireEvent.change(screen.getByLabelText('Mensagem para o Agente IA'), { target: { value: 'crie um post de lançamento' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(screen.getByText('crie um post de lançamento')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Ideia gerada pela IA')).toBeInTheDocument())

    const chatMessageCalls = apiFetchMock.mock.calls.filter(([path]) => path === '/api/ai/chat-messages')
    expect(chatMessageCalls).toHaveLength(2)
  })

  it('shows an error message if generation fails, without crashing the widget', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/ai/generate') return Promise.reject(new Error('Falha ao gerar sugestão'))
      return Promise.resolve({ ok: true })
    })

    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))
    fireEvent.change(screen.getByLabelText('Mensagem para o Agente IA'), { target: { value: 'oi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Falha ao gerar sugestão'))
  })

  it('does not submit an empty or whitespace-only message', () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch')
    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Mensagem para o Agente IA'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})
