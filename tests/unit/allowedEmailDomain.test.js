process.env.ALLOWED_EMAIL_DOMAINS = 'allowed.test'
const { getAllowedEmailDomains, isAllowedEmail } = require('../../src/utils/allowedEmailDomain')

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
