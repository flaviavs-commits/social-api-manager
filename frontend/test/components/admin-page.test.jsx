import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminPage } from '../../src/pages/admin-page.jsx'
import * as api from '../../src/lib/api.js'

const ME = { id: 1, email: 'admin@allowed.test', role: 'admin' }
const CLIENTE = { id: 7, email: 'cliente@allowed.test', fullName: 'Cliente', role: 'user', ativo: true, totalContas: 2 }

function mockLoad(users = [CLIENTE]) {
  vi.spyOn(api, 'apiFetch').mockImplementation(path => {
    if (path === '/api/me') return Promise.resolve(ME)
    if (path === '/api/admin/users') return Promise.resolve({ data: users })
    return Promise.reject(new Error(`rota não mockada: ${path}`))
  })
}

describe('AdminPage — link de pagamento por usuário', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gera o link do plano escolhido para o usuário da linha, via /api/admin/users/:id/plan-link/:plan', async () => {
    mockLoad()
    const apiFetch = vi.spyOn(api, 'apiFetch')
    apiFetch.mockImplementation(path => {
      if (path === '/api/me') return Promise.resolve(ME)
      if (path === '/api/admin/users') return Promise.resolve({ data: [CLIENTE] })
      if (path === '/api/admin/users/7/plan-link/basico') return Promise.resolve({ url: 'https://buy.stripe.com/xyz?client_reference_id=user%3A7' })
      return Promise.reject(new Error(`rota não mockada: ${path}`))
    })

    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())

    const select = screen.getByLabelText('Plano do link de pagamento para cliente@allowed.test')
    await userEvent.selectOptions(select, 'basico')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/api/admin/users/7/plan-link/basico')
  })

  it('copia o link gerado para a área de transferência', async () => {
    mockLoad()
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/me') return Promise.resolve(ME)
      if (path === '/api/admin/users') return Promise.resolve({ data: [CLIENTE] })
      if (path === '/api/admin/users/7/plan-link/basico') return Promise.resolve({ url: 'https://buy.stripe.com/xyz?client_reference_id=user%3A7' })
      return Promise.reject(new Error(`rota não mockada: ${path}`))
    })
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
    mockLoad()
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/me') return Promise.resolve(ME)
      if (path === '/api/admin/users') return Promise.resolve({ data: [CLIENTE] })
      if (path === '/api/admin/users/7/plan-link/basico') return Promise.reject(new api.ApiError('Plano selecionado inválido.', 400))
      return Promise.reject(new Error(`rota não mockada: ${path}`))
    })

    render(<AdminPage />)
    await waitFor(() => expect(screen.getByText('cliente@allowed.test')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Plano selecionado inválido.'))
  })
})
