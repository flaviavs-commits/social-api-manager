const { parseSelectedAccountIds, validateSelectedAccounts } = require('../../../src/domain/posts/accountSelection')

describe('account selection contract', () => {
  it('distinguishes an omitted selection from an explicit list', () => {
    expect(parseSelectedAccountIds(undefined)).toBeNull()
    expect(parseSelectedAccountIds('[10, 11]')).toEqual([10, 11])
    expect(() => parseSelectedAccountIds('[]')).toThrow('accountIds inválido')
  })

  it('rejects duplicate and invalid ids', () => {
    expect(() => parseSelectedAccountIds('[10, 10]')).toThrow('accountIds inválido')
    expect(() => parseSelectedAccountIds('[0, "abc"]')).toThrow('accountIds inválido')
  })

  it('does not allow selected accounts outside the selected networks', () => {
    expect(validateSelectedAccounts(['instagram'], [{ id: 10, platform: 'instagram' }])).toBeNull()
    expect(validateSelectedAccounts(['instagram'], [{ id: 20, platform: 'facebook' }])).toContain('rede que não foi escolhida')
    expect(validateSelectedAccounts(['instagram'], [])).toContain('Nenhuma conta selecionada')
  })
})
