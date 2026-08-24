function parseSelectedAccountIds(raw) {
  if (raw === undefined || raw === null || raw === '') return null

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('accountIds inválido')

  const ids = parsed.map(Number)
  if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
    throw new Error('accountIds inválido')

  return ids
}

function validateSelectedAccounts(platforms, accounts) {
  const selectedPlatforms = new Set(Array.isArray(platforms) ? platforms : [])
  const invalidPlatform = (Array.isArray(accounts) ? accounts : []).find(account => !selectedPlatforms.has(account.platform))
  if (invalidPlatform) return 'Uma ou mais contas selecionadas pertencem a uma rede que não foi escolhida.'

  const missingPlatform = (Array.isArray(platforms) ? platforms : []).find(platform => !(accounts || []).some(account => account.platform === platform))
  if (missingPlatform) return `Nenhuma conta selecionada para a rede ${missingPlatform}.`

  return null
}

module.exports = { parseSelectedAccountIds, validateSelectedAccounts }
