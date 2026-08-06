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

  it('sends a message to the operational agent, shows the reply, and persists both turns', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path, options = {}) => {
      if (path === '/api/ai/agent') return Promise.resolve({ message: 'Ideia gerada pela IA' })
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

  it('renders an image returned by the agent', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/ai/agent') return Promise.resolve({ message: 'Imagem criada', data: { image: 'data:image/png;base64,abc', modelo: 'modelo-teste' } })
      return Promise.resolve({ ok: true })
    })

    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))
    fireEvent.change(screen.getByLabelText('Mensagem para o Agente IA'), { target: { value: 'crie uma imagem' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(screen.getByAltText('Imagem criada pela IA')).toHaveAttribute('src', 'data:image/png;base64,abc'))
  })

  it('offers model choices and persists the selected model', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/ai/models') return Promise.resolve({ models: [{ id: 'openai-4o', name: 'GPT-4o', provider: 'OpenAI', available: true }] })
      if (path === '/api/ai/prefs') return Promise.resolve({ preferred_model: 'openai-4o' })
      return Promise.resolve({ ok: true })
    })

    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))

    const picker = await screen.findByRole('combobox', { name: 'Modelo de IA' })
    expect(picker).toHaveValue('openai-4o')
    fireEvent.change(picker, { target: { value: 'openai-4o' } })
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/ai/prefs', expect.objectContaining({ method: 'PUT' })))
  })

  it('shows an error message if the agent fails, without crashing the widget', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/ai/agent') return Promise.reject(new Error('Falha ao interpretar pedido'))
      return Promise.resolve({ ok: true })
    })

    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))
    fireEvent.change(screen.getByLabelText('Mensagem para o Agente IA'), { target: { value: 'oi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Falha ao interpretar pedido'))
  })

  it('does not submit an empty or whitespace-only message', () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch')
    render(<AiAssistantWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir assistente de IA' }))
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Mensagem para o Agente IA'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    expect(apiFetchMock.mock.calls.some(([path]) => path === '/api/ai/agent')).toBe(false)
  })
})
