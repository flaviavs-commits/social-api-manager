import { render, screen, waitFor } from '@testing-library/react'
import { DashboardPage } from '../../src/pages/dashboard-page.jsx'
import * as api from '../../src/lib/api.js'

describe('DashboardPage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows a loading message before data arrives, not the empty state', async () => {
    let resolvePosts
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/posts') return new Promise(resolve => { resolvePosts = resolve })
      return Promise.resolve({ accounts: [] })
    })

    render(<DashboardPage />)

    expect(screen.getByText('Carregando publicações...')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma publicação encontrada.')).not.toBeInTheDocument()

    resolvePosts({ posts: [] })
    await waitFor(() => expect(screen.getByText('Seu dashboard ainda está vazio')).toBeInTheDocument())
    expect(screen.queryByText('Visualizações')).not.toBeInTheDocument()
    expect(screen.queryByText('Publicações recentes')).not.toBeInTheDocument()
  })

  it('renders fetched posts once loaded', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(path => {
      if (path === '/api/posts') return Promise.resolve({ posts: [{ id: 1, text: 'Meu post', status: 'scheduled' }] })
      return Promise.resolve({ accounts: [{ id: 1 }] })
    })

    render(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Meu post')).toBeInTheDocument())
    expect(screen.getAllByText('1')).toHaveLength(3)
  })

  it('shows an error message if the fetch fails', async () => {
    vi.spyOn(api, 'apiFetch').mockRejectedValue(new Error('Falha de rede'))

    render(<DashboardPage />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Falha de rede'))
  })
})
