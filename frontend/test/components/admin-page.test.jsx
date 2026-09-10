import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminPage } from '../../src/pages/admin-page.jsx'
import * as api from '../../src/lib/api.js'

const ME = { id: 1, email: 'admin@allowed.test', role: 'admin' }
const CLIENTE = { id: 7, email: 'cliente@allowed.test', fullName: 'Cliente', role: 'user', ativo: true, totalContas: 2 }

const EMPTY_REPORT = { unmatched: [], checked: 0, truncated: false }

// Mock central: sempre cobre as duas chamadas que a página faz ao montar
// (usuários + relatório de conciliação) mais o que cada teste sobrescrever.
function mockApi(overrides = {}) {
  const apiFetch = vi.spyOn(api, 'apiFetch')
  apiFetch.mockImplementation(path => {
    if (path === '/api/me') return Promise.resolve(ME)
    if (path === '/api/admin/users') return Promise.resolve({ data: overrides.users || [CLIENTE] })
    if (path.startsWith('/api/admin/billing/reconciliation') && !path.includes('/link')) {
      return Promise.resolve(overrides.report || EMPTY_REPORT)
    }
    if (path === '/api/logs?limit=200') return Promise.resolve({ logs: overrides.logs || [] })
    if (overrides.extra?.[path]) return overrides.extra[path]()
    return Promise.reject(new Error(`rota não mockada: ${path}`))
  })
  return apiFetch
}

describe('AdminPage — link de pagamento por usuário', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gera o link do plano escolhido para o usuário da linha, via /api/admin/users/:id/plan-link/:plan', async () => {
    const apiFetch = mockApi({ extra: { '/api/admin/users/7/plan-link/basico': () => Promise.resolve({ url: 'https://buy.stripe.com/xyz?client_reference_id=user%3A7' }) } })

    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())

    const select = screen.getByLabelText('Plano do link de pagamento para cliente@allowed.test')
    await userEvent.selectOptions(select, 'basico')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/api/admin/users/7/plan-link/basico')
  })

  it('copia o link gerado para a área de transferência', async () => {
    mockApi({ extra: { '/api/admin/users/7/plan-link/basico': () => Promise.resolve({ url: 'https://buy.stripe.com/xyz?client_reference_id=user%3A7' }) } })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Copiar link' }))

    expect(writeText).toHaveBeenCalledWith('https://buy.stripe.com/xyz?client_reference_id=user%3A7')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiado!' })).toBeInTheDocument())
  })

  it('mostra erro na notificação quando o backend recusa o plano', async () => {
    mockApi({ extra: { '/api/admin/users/7/plan-link/basico': () => Promise.reject(new api.ApiError('Plano selecionado inválido.', 400)) } })

    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Plano selecionado inválido.'))
  })
})

describe('AdminPage — navegação por abas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/admin.html')
  })

  it('abre na aba Usuários por padrão e troca para Conciliação ao clicar', async () => {
    mockApi()
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Usuários' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText(/Pagamentos não conciliados/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Conciliação' }))

    await waitFor(() => expect(screen.getByText(/Pagamentos não conciliados/)).toBeInTheDocument())
    expect(screen.queryByText('cliente@allowed.test')).not.toBeInTheDocument()
  })

  it('reflete a aba na URL e responde a uma navegação popstate para outra aba', async () => {
    mockApi()
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Conciliação' }))
    await waitFor(() => expect(screen.getByText(/Pagamentos não conciliados/)).toBeInTheDocument())
    expect(window.location.search).toContain('tab=conciliacao')

    // Simula o navegador restaurando a URL anterior (botão "voltar") sem
    // depender de history.back() real do jsdom, que não é confiável em teste.
    window.history.replaceState({}, '', '/admin.html?tab=usuarios')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Usuários' })).toHaveAttribute('aria-current', 'page'))
    expect(screen.queryByText(/Pagamentos não conciliados/)).not.toBeInTheDocument()
  })
})

describe('AdminPage — reconciliação de pagamentos não vinculados', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/admin.html')
  })

  const ITEM = {
    sessionId: 'cs_sem_match',
    amountCents: 10050,
    currency: 'brl',
    createdAt: '2026-09-10T12:00:00.000Z',
    clientReferenceId: 'user:7',
    suggestedUserId: 7,
    customerEmail: 'cliente@allowed.test',
    suggestedPlan: 'pro',
    paymentIntent: 'pi_1',
  }

  // A seção só monta na aba "Conciliação" — abre direto lá via URL para não
  // repetir o clique em cada teste.
  async function renderNaAbaConciliacao() {
    window.history.pushState({}, '', '/admin.html?tab=conciliacao')
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conciliação' })).toHaveAttribute('aria-current', 'page'))
  }

  it('mostra o estado vazio quando não há pagamento pendente de conciliação', async () => {
    mockApi()
    await renderNaAbaConciliacao()
    await waitFor(() => expect(screen.getByText(/Nenhum pagamento sem conciliação/)).toBeInTheDocument())
  })

  it('lista um pagamento não conciliado com o plano sugerido pré-selecionado', async () => {
    mockApi({ report: { unmatched: [ITEM], checked: 3, truncated: false } })
    await renderNaAbaConciliacao()

    // O e-mail aparece na célula da tabela e também como opção do select de
    // usuário; getByRole('cell', ...) ignora a segunda.
    await waitFor(() => expect(screen.getByRole('cell', { name: 'cliente@allowed.test' })).toBeInTheDocument())
    expect(screen.getByText('R$ 100,50')).toBeInTheDocument()
    expect(screen.getByLabelText('Plano para vincular a sessão cs_sem_match')).toHaveValue('pro')
  })

  it('vincula o pagamento ao usuário sugerido e remove a linha da lista', async () => {
    const apiFetch = mockApi({
      users: [CLIENTE],
      report: { unmatched: [ITEM], checked: 1, truncated: false },
      extra: { '/api/admin/billing/reconciliation/cs_sem_match/link': () => Promise.resolve({ status: 'paid' }) },
    })
    await renderNaAbaConciliacao()
    await waitFor(() => expect(screen.getByLabelText('Usuário para vincular a sessão cs_sem_match')).toHaveValue('7'))

    await userEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    expect(apiFetch).toHaveBeenCalledWith('/api/admin/billing/reconciliation/cs_sem_match/link', {
      method: 'POST',
      body: JSON.stringify({ userId: 7, plan: 'pro' }),
    })
    await waitFor(() => expect(screen.getByText(/Nenhum pagamento sem conciliação/)).toBeInTheDocument())
  })

  it('mostra erro e mantém a linha quando o backend recusa a vinculação', async () => {
    mockApi({
      report: { unmatched: [ITEM], checked: 1, truncated: false },
      extra: { '/api/admin/billing/reconciliation/cs_sem_match/link': () => Promise.reject(new api.ApiError('Essa sessão não está marcada como paga na Stripe.', 400)) },
    })
    await renderNaAbaConciliacao()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Essa sessão não está marcada como paga na Stripe.'))
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeInTheDocument()
  })

  it('avisa quando o relatório foi cortado pelo limite de sessões', async () => {
    mockApi({ report: { unmatched: [], checked: 500, truncated: true } })
    await renderNaAbaConciliacao()
    await waitFor(() => expect(screen.getByText(/lista foi cortada em 500 sessões/)).toBeInTheDocument())
  })

  it('recarrega com o período escolhido no seletor de dias', async () => {
    const apiFetch = mockApi()
    await renderNaAbaConciliacao()
    await waitFor(() => expect(screen.getByText(/Nenhum pagamento sem conciliação/)).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByDisplayValue('Últimos 7 dias'), '30')

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/admin/billing/reconciliation?days=30'))
  })
})

describe('AdminPage — histórico de ações administrativas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/admin.html')
  })

  const LOG_ROLE = { id: 10, type: 'ok', message: 'Papel alterado para "user".', timestamp: '2026-09-10T12:00:00.000Z' }
  const LOG_ERRO = { id: 11, type: 'err', message: 'Falha ao enviar alerta de pagamento não vinculado: Gmail indisponível', timestamp: '2026-09-10T11:00:00.000Z' }

  async function renderNaAbaHistorico() {
    window.history.pushState({}, '', '/admin.html?tab=historico')
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Histórico' })).toHaveAttribute('aria-current', 'page'))
  }

  it('mostra o estado vazio quando não há ação administrativa registrada', async () => {
    mockApi()
    await renderNaAbaHistorico()
    await waitFor(() => expect(screen.getByText('Nenhuma ação administrativa registrada ainda.')).toBeInTheDocument())
  })

  it('lista as ações vindas de /api/logs', async () => {
    mockApi({ logs: [LOG_ROLE, LOG_ERRO] })
    await renderNaAbaHistorico()

    await waitFor(() => expect(screen.getByText('Papel alterado para "user".')).toBeInTheDocument())
    expect(screen.getByText(/Falha ao enviar alerta/)).toBeInTheDocument()
  })

  it('filtra por tipo de atividade', async () => {
    mockApi({ logs: [LOG_ROLE, LOG_ERRO] })
    await renderNaAbaHistorico()
    await waitFor(() => expect(screen.getByText('Papel alterado para "user".')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText('Filtrar tipo de atividade'), 'err')

    expect(screen.queryByText('Papel alterado para "user".')).not.toBeInTheDocument()
    expect(screen.getByText(/Falha ao enviar alerta/)).toBeInTheDocument()
  })

  it('filtra por busca textual', async () => {
    mockApi({ logs: [LOG_ROLE, LOG_ERRO] })
    await renderNaAbaHistorico()
    await waitFor(() => expect(screen.getByText('Papel alterado para "user".')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Buscar no histórico'), 'gmail')

    expect(screen.queryByText('Papel alterado para "user".')).not.toBeInTheDocument()
    expect(screen.getByText(/Falha ao enviar alerta/)).toBeInTheDocument()
  })
})
