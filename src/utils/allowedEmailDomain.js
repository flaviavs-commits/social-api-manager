function getAllowedEmailDomains() {
  return String(process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(domain => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
}

function allowedEmailDomainLabel() {
  return getAllowedEmailDomains().map(domain => `@${domain}`).join(', ')
}

function isAllowedEmail(email) {
  if (typeof email !== 'string') return false
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return false
  const domain = normalized.slice(at + 1)
  return getAllowedEmailDomains().includes(domain)
}

module.exports = { getAllowedEmailDomains, allowedEmailDomainLabel, isAllowedEmail }
