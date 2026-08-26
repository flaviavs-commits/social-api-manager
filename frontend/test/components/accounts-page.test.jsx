import { render, screen, waitFor } from '@testing-library/react'
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
})
