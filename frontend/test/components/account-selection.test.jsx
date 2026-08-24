import { accountsForPlatform, buildAccountSelectionIssues, selectedAccountsForPost } from '../../src/lib/account-selection.js'

const accounts = [
  { id: 10, platform: 'instagram', handle: '@marca-a' },
  { id: 11, platform: 'instagram', handle: '@marca-b' },
  { id: 20, platform: 'facebook', handle: 'Página principal' },
]

describe('account selection', () => {
  it('keeps different accounts from the same network available', () => {
    expect(accountsForPlatform(accounts, 'instagram')).toHaveLength(2)
    expect(selectedAccountsForPost(accounts, ['instagram'], [11])).toEqual([11])
  })

  it('returns all selected account ids only for selected networks', () => {
    expect(selectedAccountsForPost(accounts, ['instagram', 'facebook'], [10, 11, 20])).toEqual([10, 11, 20])
    expect(selectedAccountsForPost(accounts, ['instagram'], [10, 11, 20])).toEqual([10, 11])
  })

  it('reports a missing account selection before submit', () => {
    expect(buildAccountSelectionIssues(accounts, ['instagram'], [])).toEqual([
      { platform: 'instagram', message: 'Selecione pelo menos uma conta de Instagram para continuar.' },
    ])
    expect(buildAccountSelectionIssues(accounts, ['youtube'], [])).toEqual([
      { platform: 'youtube', message: 'Nenhuma conta de YouTube está conectada.' },
    ])
  })
})
