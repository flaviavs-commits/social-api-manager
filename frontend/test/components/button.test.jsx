import { render, screen } from '@testing-library/react'
import { Button } from '../../src/components/ui/button.jsx'

describe('Button', () => {
  it('renders as a button by default with the primary variant class', () => {
    render(<Button>Salvar</Button>)
    const el = screen.getByRole('button', { name: 'Salvar' })
    expect(el.tagName).toBe('BUTTON')
    expect(el.className).toBe('felixo-button felixo-button--primary felixo-button--md')
  })

  it('renders as a link when href is given, preserving the href', () => {
    render(<Button href="/login.html" variant="secondary">Entrar</Button>)
    const el = screen.getByRole('link', { name: 'Entrar' })
    expect(el.tagName).toBe('A')
    expect(el).toHaveAttribute('href', '/login.html')
    expect(el.className).toBe('felixo-button felixo-button--secondary felixo-button--md')
  })

  it('supports accessible sizes and forwards button attributes', () => {
    render(<Button size="lg" type="submit" aria-label="Confirmar">Continuar</Button>)
    const el = screen.getByRole('button', { name: 'Confirmar' })
    expect(el).toHaveClass('felixo-button--lg')
    expect(el).toHaveAttribute('type', 'submit')
  })

  it('merges a custom class with the component classes', () => {
    render(<Button className="extra-class">Mais</Button>)
    expect(screen.getByRole('button', { name: 'Mais' })).toHaveClass('felixo-button', 'extra-class')
  })
})
