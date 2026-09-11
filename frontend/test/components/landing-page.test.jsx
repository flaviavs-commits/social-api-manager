import { render, screen, fireEvent, within } from '@testing-library/react'
import { LandingPage } from '../../src/pages/landing-page.jsx'
import { PLANS } from '../../src/lib/plans.js'

describe('LandingPage', () => {
  it('leads with the product promise and keeps pricing below the explanation', () => {
    const { container } = render(<LandingPage />)
    const hero = screen.getByRole('region', { name: /sua rotina/i })
    expect(hero).toHaveTextContent('resolvida.')
    expect(hero.textContent).not.toMatch(/planos|preços|R\$/i)
    expect(within(hero).getByRole('link', { name: /Comece agora/ })).toHaveAttribute('href', '/criar-conta')
    expect(container.querySelector('.mkt-stage')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\bIA\b|artificial/i)
    const sections = [...container.querySelectorAll('main > section')].map(section => section.id)
    expect(sections.indexOf('planos')).toBeGreaterThan(sections.indexOf('como-funciona'))
    for (const plan of Object.values(PLANS)) {
      expect(container.querySelector(`a[href="/criar-conta?plan=${plan.id}"]`)).toBeInTheDocument()
      expect(screen.getByText(plan.price)).toBeInTheDocument()
    }
  })

  it('turns the resources section into a scroll-linked timeline', () => {
    render(<LandingPage />)
    const timeline = screen.getByRole('region', { name: 'Recursos em destaque' })

    expect(timeline).toHaveClass('mkt-scroll-timeline')
    expect(timeline.querySelectorAll('.mkt-scroll-timeline-card')).toHaveLength(6)
    expect(timeline.querySelector('.mkt-scroll-timeline-progress')).toBeInTheDocument()
    expect(timeline.querySelector('.mkt-scroll-timeline-orb')).toBeInTheDocument()
    expect(timeline.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
  })

  it('opens the mobile navigation and closes it after choosing a section or pressing Escape', () => {
    render(<LandingPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    expect(screen.getByRole('button', { name: 'Fechar menu' })).toHaveAttribute('aria-expanded', 'true')
    const primaryNav = screen.getByRole('navigation', { name: 'Navegação principal' })
    fireEvent.click(within(primaryNav).getByRole('link', { name: 'O que você ganha' }))
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false')
  })
})
