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

describe('AdminPage — reconciliação de pagamentos não vinculados', () => {
  afterEach(() => vi.restoreAllMocks())

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

  it('mostra o estado vazio quando não há pagamento pendente de conciliação', async () => {
    mockApi()
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText(/Nenhum pagamento sem conciliação/)).toBeInTheDocument())
  })

  it('lista um pagamento não conciliado com o plano sugerido pré-selecionado', async () => {
    mockApi({ report: { unmatched: [ITEM], checked: 3, truncated: false } })
    render(<AdminPage />)

    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())
    expect(screen.getByText('R$ 100,50')).toBeInTheDocument()
    expect(screen.getByLabelText('Plano para vincular a sessão cs_sem_match')).toHaveValue('pro')
  })

  it('vincula o pagamento ao usuário sugerido e remove a linha da lista', async () => {
    const apiFetch = mockApi({
      users: [CLIENTE],
      report: { unmatched: [ITEM], checked: 1, truncated: false },
      extra: { '/api/admin/billing/reconciliation/cs_sem_match/link': () => Promise.resolve({ status: 'paid' }) },
    })
    render(<AdminPage />)
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
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Essa sessão não está marcada como paga na Stripe.'))
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeInTheDocument()
  })

  it('avisa quando o relatório foi cortado pelo limite de sessões', async () => {
    mockApi({ report: { unmatched: [], checked: 500, truncated: true } })
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText(/lista foi cortada em 500 sessões/)).toBeInTheDocument())
  })

  it('recarrega com o período escolhido no seletor de dias', async () => {
    const apiFetch = mockApi()
    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText(/Nenhum pagamento sem conciliação/)).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByDisplayValue('Últimos 7 dias'), '30')

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/admin/billing/reconciliation?days=30'))
  })
})
