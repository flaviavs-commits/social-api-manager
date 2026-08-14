import { parseLoginQuery } from '../../src/pages/auth-page.jsx'

describe('parâmetros da tela de login', () => {
  it('aceita somente o sinalizador de cadastro e planos conhecidos', () => {
    expect(parseLoginQuery('?register=1&plan=criador')).toEqual({
      register: true,
      selectedPlan: 'criador',
      error: null
    })
  })

  it('descarta parâmetros arbitrários e mensagens não autorizadas', () => {
    expect(parseLoginQuery('?register=true&plan=https%3A%2F%2Fevil.example&error=%3Csvg%20onload%3Dalert(1)%3E&next=https%3A%2F%2Fevil.example')).toEqual({
      register: false,
      selectedPlan: null,
      error: null
    })
  })

  it('aceita somente erro conhecido do fluxo OAuth', () => {
    expect(parseLoginQuery('?error=Login%20com%20Google%20cancelado.').error).toBe('Login com Google cancelado.')
  })
})
