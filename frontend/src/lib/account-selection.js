export function accountIdKey(value) {
  return String(value?.id ?? value)
}

export function accountsForPlatform(accounts, platform) {
  return (Array.isArray(accounts) ? accounts : []).filter(account => account.platform === platform)
}

// A conta já carrega o dono da conexão no payload da API. Agrupar por essa
// identidade permite mostrar, no agendador, todas as redes de uma mesma pessoa
// juntas sem misturar as contas de outra pessoa.
export function groupAccountsByPerson(accounts) {
  const groups = new Map()
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const ownerEmail = String(account.ownerEmail || account.owner_email || '').trim()
    const ownerId = account.userId ?? account.user_id
    const key = ownerEmail.toLowerCase() || (ownerId ? `user:${ownerId}` : 'current-user')
    const label = ownerEmail || (ownerId ? `Pessoa ${ownerId}` : 'Pessoa atual')
    if (!groups.has(key)) groups.set(key, { key, label, ownerEmail, ownerId: ownerId || null, accounts: [] })
    groups.get(key).accounts.push(account)
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

export function selectedAccountsForPost(accounts, platforms, selectedAccountIds) {
  const selected = new Set((Array.isArray(selectedAccountIds) ? selectedAccountIds : []).map(accountIdKey))
  const allowedPlatforms = new Set(Array.isArray(platforms) ? platforms : [])
  return (Array.isArray(accounts) ? accounts : [])
    .filter(account => allowedPlatforms.has(account.platform) && selected.has(accountIdKey(account)))
    .map(account => account.id)
}

export function buildAccountSelectionIssues(accounts, platforms, selectedAccountIds) {
  return (Array.isArray(platforms) ? platforms : []).flatMap(platform => {
    const platformAccounts = accountsForPlatform(accounts, platform)
    const selected = new Set((Array.isArray(selectedAccountIds) ? selectedAccountIds : []).map(accountIdKey))
    const selectedCount = platformAccounts.filter(account => selected.has(accountIdKey(account))).length
    const label = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }[platform] || platform

    if (!platformAccounts.length) return [{ platform, message: `Nenhuma conta de ${label} está conectada.` }]
    if (!selectedCount) return [{ platform, message: `Selecione pelo menos uma conta de ${label} para continuar.` }]
    return []
  })
}
