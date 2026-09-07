// Integração com o Meu Ecoo — fonte da verdade da identidade do ecossistema
// Vitis Souls (decisão de 29/07/2026). Este app mantém seu próprio banco,
// bcrypt e TOTP; nenhum dado interno muda de dono. O que muda é a credencial:
//
//   - sincronizarCredencial: depois de um login local certo (bcrypt), empurra
//     a senha em texto para o Meu Ecoo gravar o hash pbkdf2 dele. Best-effort:
//     nunca lança, nunca bloqueia o login.
//   - autenticarViaMeuEcoo: fallback quando o bcrypt local falha (ex.: senha
//     trocada só no Meu Ecoo). Se confirmar, o chamador re-hasheia com bcrypt.

const PARTNER_LOGIN_PATH = '/api/partner/auth/login'
const PARTNER_SYNC_PATH = '/api/partner/auth/sync-credential'
const TIMEOUT_MS = 5000
const { safeMessage } = require('../utils/redact')

function getConfig() {
  const url = process.env.MEU_ECOO_API_URL
  const token = process.env.MEU_ECOO_SERVICE_TOKEN
  if (!url || !token) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null
    return { url: parsed.toString().replace(/\/$/, ''), token }
  } catch {
    return null
  }
}

async function sincronizarCredencial(email, password, nome) {
  const config = getConfig()
  if (!config) return

  try {
    await fetch(`${config.url}${PARTNER_SYNC_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.token },
      body: JSON.stringify({ email, password, nome, origemApp: 'social-api-manager' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    console.error('[Meu Ecoo] falha ao sincronizar credencial:', safeMessage(err?.message))
  }
}

async function autenticarViaMeuEcoo(email, password) {
  const config = getConfig()
  if (!config) return false

  try {
    const res = await fetch(`${config.url}${PARTNER_LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.token },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok
  } catch (err) {
    console.error('[Meu Ecoo] falha ao autenticar via fallback:', safeMessage(err?.message))
    return false
  }
}

module.exports = { sincronizarCredencial, autenticarViaMeuEcoo }
