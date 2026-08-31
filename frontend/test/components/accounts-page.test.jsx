import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AccountsPage } from '../../src/pages/accounts-page.jsx'
import { ToastProvider } from '../../src/components/ui/toast.jsx'
import * as api from '../../src/lib/api.js'

describe('AccountsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows every supported network and the connected account inside its network card', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/accounts') return Promise.resolve({ data: [{ id: 113, platform: 'instagram', handle: '@breno_dev_', tokens: [{ status: 'valid' }] }] })
      if (path === '/api/platform-health') return Promise.resolve({ platforms: { facebook: 'up', instagram: 'up', youtube: 'up', tiktok: 'up' } })
      return Promise.resolve({})
    })

    render(<ToastProvider><AccountsPage user={{ planUnrestricted: true }} /></ToastProvider>)

    expect(await screen.findByRole('heading', { name: 'Instagram' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Facebook' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'YouTube' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'TikTok' })).toBeInTheDocument()
    expect(screen.getByText('@breno_dev_')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desconectar @breno_dev_' })).toBeInTheDocument()
  })

  it('disconnects an account from the network card', async () => {
    let connected = [{ id: 113, platform: 'instagram', handle: '@breno_dev_', tokens: [{ status: 'valid' }] }]
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path, options = {}) => {
      if (path === '/api/accounts') return Promise.resolve({ data: connected })
      if (path === '/api/platform-health') return Promise.resolve({ platforms: {} })
      if (path === '/api/accounts/113' && options.method === 'DELETE') {
        connected = []
        return Promise.resolve({ deleted: true })
      }
      return Promise.resolve({})
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    render(<ToastProvider><AccountsPage user={{ planUnrestricted: true }} /></ToastProvider>)
    const disconnect = await screen.findByRole('button', { name: 'Desconectar @breno_dev_' })
    disconnect.click()

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/accounts/113', { method: 'DELETE' }))
    await waitFor(() => expect(screen.queryByText('@breno_dev_')).not.toBeInTheDocument())
  })

  it('removes the selected account from the account action panel', async () => {
    let connected = [{ id: 113, platform: 'instagram', handle: '@breno_dev_', tokens: [{ status: 'valid' }] }]
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path, options = {}) => {
      if (path === '/api/accounts') return Promise.resolve({ data: connected })
      if (path === '/api/platform-health') return Promise.resolve({ platforms: {} })
      if (path === '/api/accounts/113' && options.method === 'DELETE') {
        connected = []
        return Promise.resolve({ deleted: true })
      }
      return Promise.resolve({})
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    render(<ToastProvider><AccountsPage user={{ planUnrestricted: true }} /></ToastProvider>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Remover uma conta' }))
    fireEvent.change(screen.getByLabelText('Conta para remover'), { target: { value: '113' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remover conta' }))

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/accounts/113', { method: 'DELETE' }))
    await waitFor(() => expect(screen.queryByText('@breno_dev_')).not.toBeInTheDocument())
  })

  it('opens the add account flow and starts the OAuth connection', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/accounts') return Promise.resolve({ data: [] })
      if (path === '/api/platform-health') return Promise.resolve({ platforms: {} })
      if (path.startsWith('/auth/instagram?')) return Promise.resolve({ authUrl: 'https://provider.example/oauth' })
      return Promise.resolve({})
    })
    vi.spyOn(window, 'open').mockImplementation(() => ({ closed: false, location: { href: '' } }))

    render(<ToastProvider><AccountsPage user={{ planUnrestricted: true }} /></ToastProvider>)

    expect(screen.getByRole('tab', { name: 'Adicionar uma conta' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Plataforma'), { target: { value: 'instagram' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Conectar' }).at(-1))

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/auth/instagram?accountName=&platform=instagram&returnTo=%2F'))
  })

  it('does not offer another account when the plan connection limit is reached', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/accounts') return Promise.resolve({ data: [
        { id: 1, platform: 'instagram', handle: '@one', tokens: [{ status: 'valid' }] },
        { id: 2, platform: 'youtube', handle: '@two', tokens: [{ status: 'valid' }] },
      ] })
      if (path === '/api/platform-health') return Promise.resolve({ platforms: {} })
      return Promise.resolve({})
    })

    render(<ToastProvider><AccountsPage user={{ plan: 'basico' }} /></ToastProvider>)

    const instagramCard = (await screen.findByRole('heading', { name: 'Instagram' })).closest('article')
    expect(within(instagramCard).getByRole('button', { name: 'Limite atingido' })).toBeDisabled()
  })
})
