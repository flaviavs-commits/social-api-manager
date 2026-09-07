const { validateOutboundHttpsUrl } = require('../../src/utils/outboundUrl')

describe('validateOutboundHttpsUrl', () => {
  test('permite HTTPS para IP público', async () => {
    await expect(validateOutboundHttpsUrl('https://8.8.8.8/hook')).resolves.toBe('https://8.8.8.8/hook')
  })

  test.each([
    'http://127.0.0.1/hook',
    'https://localhost/hook',
    'https://192.168.1.10/hook',
    'https://[::1]/hook',
    'https://user:pass@example.com/hook',
  ])('bloqueia destino proibido: %s', async url => {
    await expect(validateOutboundHttpsUrl(url)).rejects.toThrow()
  })

  test.each([
    'https://[::ffff:10.0.0.1]/hook',
    'https://[::ffff:172.16.0.1]/hook',
    'https://[::ffff:192.168.1.1]/hook',
  ])('bloqueia IPv4 privado representado como IPv6: %s', async url => {
    await expect(validateOutboundHttpsUrl(url)).rejects.toThrow()
  })
})
