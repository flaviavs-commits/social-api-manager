import { render, screen, fireEvent } from '@testing-library/react'
import { AppShell } from '../../src/components/layout/app-shell.jsx'

describe('AppShell', () => {
  it('marks the active page with the "Ativo" badge and highlights it', () => {
    render(<AppShell page="calendario" onPageChange={() => {}}>conteúdo</AppShell>)
    const activeButton = screen.getByRole('button', { name: /Calendário/ })
    expect(activeButton).toHaveTextContent('Ativo')
  })

  it('calls onPageChange with the clicked nav key', () => {
    const onPageChange = vi.fn()
    render(<AppShell page="dashboard" onPageChange={onPageChange}>conteúdo</AppShell>)
    fireEvent.click(screen.getByRole('button', { name: /Rascunhos/ }))
    expect(onPageChange).toHaveBeenCalledWith('rascunhos')
  })

  it('shows the current page name as breadcrumb in the header', () => {
    render(<AppShell page="tokens" onPageChange={() => {}}>conteúdo</AppShell>)
    expect(screen.getByRole('navigation', { name: 'Localização atual' })).toHaveTextContent('Tokens')
  })

  it('"+ Criar Novo Post" navigates to the scheduler page', () => {
    const onPageChange = vi.fn()
    render(<AppShell page="dashboard" onPageChange={onPageChange}>conteúdo</AppShell>)
    fireEvent.click(screen.getByRole('button', { name: '+ Criar Novo Post' }))
    expect(onPageChange).toHaveBeenCalledWith('agendador')
  })

  it('renders the user name when provided, falling back to a default label', () => {
    const { rerender } = render(<AppShell page="dashboard" onPageChange={() => {}} user={{ name: 'Tiago' }}>x</AppShell>)
    expect(screen.getByText('Tiago')).toBeInTheDocument()
    rerender(<AppShell page="dashboard" onPageChange={() => {}}>x</AppShell>)
    expect(screen.getByText('Conta')).toBeInTheDocument()
  })
})
