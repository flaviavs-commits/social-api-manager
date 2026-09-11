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

  it('keeps all six resources mounted, exposes one step and offers direct navigation', () => {
    render(<LandingPage />)
    const timeline = screen.getByRole('region', { name: 'Recursos em destaque' })

    expect(timeline).toHaveClass('mkt-product-story')
    expect(timeline.querySelectorAll('.story-step')).toHaveLength(6)
    expect(within(timeline).getAllByRole('article')).toHaveLength(1)
    expect(timeline.querySelectorAll('.story-step[inert]')).toHaveLength(5)
    expect(within(timeline).getAllByRole('button', { name: /Etapa/ })).toHaveLength(6)
    expect(within(timeline).getByRole('link', { name: /Pular etapas/ })).toHaveAttribute('href', '#como-funciona')
    expect(timeline.querySelector('.story-progress')).toBeInTheDocument()
    expect(timeline.querySelector('.story-indicator')).toBeInTheDocument()
    expect(timeline.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(timeline.querySelectorAll('.story-hero')).toHaveLength(1)
    expect(timeline.querySelectorAll('.story-social')).toHaveLength(4)
    expect(timeline.textContent).not.toMatch(/café|aurora|nativa|sem lactose|12,4k|8,1%|LinkedIn|Pinterest/i)
    expect([...timeline.querySelectorAll('.story-step')].at(-1)).toHaveTextContent('Entenda sem montar planilhas.')
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
