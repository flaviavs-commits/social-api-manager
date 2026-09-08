import { fireEvent, render, screen } from '@testing-library/react'
import { PublicationStatusModal } from '../../src/components/ui/publication-status-modal.jsx'

describe('PublicationStatusModal', () => {
  it('shows the scheduled confirmation in the publication modal', () => {
    const onClose = vi.fn()

    const { rerender, unmount } = render(<PublicationStatusModal
      status={{ type: 'scheduled', date: 'quarta-feira, 2 de setembro de 2026 às 15:50', platformList: ['Instagram'] }}
      platforms={['instagram']}
      onClose={onClose}
    />)

    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('dialog', { name: 'Seu post está na agenda' })).toBeInTheDocument()
    expect(screen.getByText('TUDO CERTO!')).toBeInTheDocument()
    expect(screen.getByText(/Ele será publicado em/)).toBeInTheDocument()
    expect(screen.getByText('quarta-feira, 2 de setembro de 2026 às 15:50')).toBeInTheDocument()
    expect(screen.getByText('Redes selecionadas')).toBeInTheDocument()
    expect(screen.getByText('✓ Instagram')).toBeInTheDocument()
    expect(screen.getByText('Você pode acompanhar ou editar esse agendamento no calendário.')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Fechar confirmação' })[1])
    expect(onClose).toHaveBeenCalledOnce()

    rerender(<PublicationStatusModal
      status={{ type: 'success', platformList: ['Instagram'] }}
      platforms={['instagram']}
      onClose={onClose}
    />)
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
