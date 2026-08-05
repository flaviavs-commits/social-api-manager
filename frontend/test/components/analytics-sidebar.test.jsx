import { fireEvent, render, screen } from '@testing-library/react'
import { AnalyticsSidebar } from '../../src/components/analytics/analytics-sidebar.jsx'

describe('AnalyticsSidebar', () => {
  it('apresenta redes como controles acessíveis e explica a escolha', () => {
    const onSelect = vi.fn()
    render(<AnalyticsSidebar networks={['instagram', 'youtube']} activeNet="instagram" onSelect={onSelect}/>)

    expect(screen.getByText('Escolha uma rede')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Instagram/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /YouTube/ }))
    expect(onSelect).toHaveBeenCalledWith('youtube')
  })
})
