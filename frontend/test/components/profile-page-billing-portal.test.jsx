import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePage } from '../../src/pages/profile-page.jsx'
import { ToastProvider } from '../../src/components/ui/toast.jsx'
import * as api from '../../src/lib/api.js'

// Cobre só o botão "Gerenciar assinatura" (Customer Portal, task de
// 10/09/2026) — o restante do perfil já é grande o bastante para merecer
// sua própria suíte dedicada, fora do escopo desta entrega.

const PROFILE = { id: 7, email: 'cliente@allowed.test', fullName: 'Cliente', plan: 'pro', planActive: true }

function mockApi({ subscription = null, extra = {} } = {}) {
  const apiFetch = vi.spyOn(api, 'apiFetch')
  apiFetch.mockImplementation(path => {
    if (path === '/api/me/profile') return Promise.resolve(PROFILE)
    if (path === '/api/billing/status') return Promise.resolve({ currentPlan: 'pro', planActive: true, subscription })
    if (extra[path]) return extra[path]()
    return Promise.reject(new Error(`rota não mockada: ${path}`))
  })
  return apiFetch
}

describe('ProfilePage — Gerenciar assinatura (Customer Portal)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('não mostra o botão quando não há assinatura gerenciável', async () => {
    mockApi({ subscription: null })
    render(<ToastProvider><ProfilePage user={PROFILE} /></ToastProvider>)

    await waitFor(() => expect(screen.getByText('Plano atual: EcooMidia Pro')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Gerenciar assinatura' })).not.toBeInTheDocument()
  })

  it('não mostra o botão quando a assinatura está cancelada', async () => {
    mockApi({ subscription: { status: 'canceled', plan: 'pro', cancelAtPeriodEnd: true, currentPeriodEnd: null, manageable: false } })
    render(<ToastProvider><ProfilePage user={PROFILE} /></ToastProvider>)

    await waitFor(() => expect(screen.getByText('Plano atual: EcooMidia Pro')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Gerenciar assinatura' })).not.toBeInTheDocument()
  })

  it('mostra o botão e redireciona para o portal quando a assinatura está ativa', async () => {
    mockApi({
      subscription: { status: 'active', plan: 'pro', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-10-10T00:00:00.000Z', manageable: true },
      extra: { '/api/billing/portal': () => Promise.resolve({ url: 'https://billing.stripe.com/p/session?secret=xyz' }) },
    })
    delete window.location
    window.location = { assign: vi.fn() }

    render(<ToastProvider><ProfilePage user={PROFILE} /></ToastProvider>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerenciar assinatura' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Gerenciar assinatura' }))

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session?secret=xyz'))
  })

  it('avisa quando a assinatura já está marcada para cancelar ao fim do período', async () => {
    mockApi({ subscription: { status: 'active', plan: 'pro', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-10-10T00:00:00.000Z', manageable: true } })
    render(<ToastProvider><ProfilePage user={PROFILE} /></ToastProvider>)

    await waitFor(() => expect(screen.getByText(/já está marcada para cancelar ao fim do período/)).toBeInTheDocument())
  })

  it('mostra erro na notificação quando o backend recusa abrir o portal', async () => {
    mockApi({
      subscription: { status: 'active', plan: 'pro', cancelAtPeriodEnd: false, currentPeriodEnd: null, manageable: true },
      extra: { '/api/billing/portal': () => Promise.reject(new api.ApiError('Você ainda não tem uma assinatura paga para gerenciar.', 400)) },
    })

    render(<ToastProvider><ProfilePage user={PROFILE} /></ToastProvider>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerenciar assinatura' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Gerenciar assinatura' }))

    await waitFor(() => expect(screen.getByText('Você ainda não tem uma assinatura paga para gerenciar.')).toBeInTheDocument())
  })
})
