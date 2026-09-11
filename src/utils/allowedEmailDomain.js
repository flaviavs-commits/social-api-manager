function parseDomainList(envValue) {
  return String(envValue || '')
    .split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(domain => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
}

function emailDomain(email) {
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return null
  return normalized.slice(at + 1)
}

function getAllowedEmailDomains() {
  return parseDomainList(process.env.ALLOWED_EMAIL_DOMAINS)
}

function allowedEmailDomainLabel() {
  return getAllowedEmailDomains().map(domain => `@${domain}`).join(', ')
}

function isAllowedEmail(email) {
  const domain = emailDomain(email)
  return domain !== null && getAllowedEmailDomains().includes(domain)
}

// Contas do(s) domínio(s) internos usam a aplicação sem pagar (decisão do
// dono do produto, 11/09/2026, task "decidir se o cadastro público sai da
// allowlist de domínio"): quando o cadastro externo for liberado, e-mails
// fora daqui continuam exigindo pagamento — a liberação de acesso (quem pode
// se cadastrar, ALLOWED_EMAIL_DOMAINS) e a isenção de pagamento (quem não
// paga, FREE_INTERNAL_EMAIL_DOMAINS) são decisões independentes, com
// variáveis próprias, mesmo hoje tendo o mesmo valor (vitissouls.com) —
// reaproveitar ALLOWED_EMAIL_DOMAINS para os dois fins divergiria assim que
// a allowlist for esvaziada para o lançamento.
function getFreeInternalEmailDomains() {
  return parseDomainList(process.env.FREE_INTERNAL_EMAIL_DOMAINS)
}

function isFreeInternalEmail(email) {
  const domain = emailDomain(email)
  return domain !== null && getFreeInternalEmailDomains().includes(domain)
}

module.exports = { getAllowedEmailDomains, allowedEmailDomainLabel, isAllowedEmail, getFreeInternalEmailDomains, isFreeInternalEmail }
