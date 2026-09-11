process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'
process.env.FREE_INTERNAL_EMAIL_DOMAINS = 'internal.test'
const { getAllowedEmailDomains, isAllowedEmail, getFreeInternalEmailDomains, isFreeInternalEmail } = require('../../src/utils/allowedEmailDomain')

describe('domínio permitido da aplicação', () => {
  test('aceita somente e-mails do domínio configurado', () => {
    expect(getAllowedEmailDomains()).toEqual(['allowed.test'])
    expect(isAllowedEmail('pessoa@allowed.test')).toBe(true)
    expect(isAllowedEmail('PESSOA+equipe@ALLOWED.TEST')).toBe(true)
    expect(isAllowedEmail('pessoa@outro.com')).toBe(false)
    expect(isAllowedEmail('pessoa@sub.allowed.test')).toBe(false)
    expect(isAllowedEmail('allowed.test')).toBe(false)
  })
})

describe('domínio interno isento de pagamento', () => {
  test('reconhece só o(s) domínio(s) configurado(s) em FREE_INTERNAL_EMAIL_DOMAINS', () => {
    expect(getFreeInternalEmailDomains()).toEqual(['internal.test'])
    expect(isFreeInternalEmail('pessoa@internal.test')).toBe(true)
    expect(isFreeInternalEmail('PESSOA+equipe@INTERNAL.TEST')).toBe(true)
    expect(isFreeInternalEmail('pessoa@allowed.test')).toBe(false)
    expect(isFreeInternalEmail('pessoa@sub.internal.test')).toBe(false)
  })

  test('é independente de ALLOWED_EMAIL_DOMAINS mesmo quando os valores coincidem hoje', () => {
    const original = process.env.FREE_INTERNAL_EMAIL_DOMAINS
    process.env.FREE_INTERNAL_EMAIL_DOMAINS = ''
    expect(isFreeInternalEmail('pessoa@allowed.test')).toBe(false)
    expect(isAllowedEmail('pessoa@allowed.test')).toBe(true)
    process.env.FREE_INTERNAL_EMAIL_DOMAINS = original
  })

  test('sem a variável configurada, nenhum e-mail é isento', () => {
    const original = process.env.FREE_INTERNAL_EMAIL_DOMAINS
    delete process.env.FREE_INTERNAL_EMAIL_DOMAINS
    expect(getFreeInternalEmailDomains()).toEqual([])
    expect(isFreeInternalEmail('qualquer@dominio.com')).toBe(false)
    process.env.FREE_INTERNAL_EMAIL_DOMAINS = original
  })
})
