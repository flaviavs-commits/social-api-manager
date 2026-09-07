const { gerarTokenSessao, gerarTokenPending2fa } = require('./authToken')
const crypto = require('crypto')

const AUTH_COOKIE = 'auth_session'
const PENDING_2FA_COOKIE = 'pending_2fa'
const CSRF_COOKIE = 'csrf_token'
const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state'
const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60
const PENDING_MAX_AGE_SECONDS = 5 * 60
const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60

function cookieOptions(maxAge) {
  const production = process.env.NODE_ENV === 'production'
  return [
    `Max-Age=${maxAge}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${production ? 'None' : 'Lax'}`,
    ...(production ? ['Secure'] : [])
  ].join('; ')
}

function setCookie(res, name, value, maxAge) {
  const current = res.getHeader('Set-Cookie')
  const cookies = Array.isArray(current) ? current : current ? [current] : []
  cookies.push(`${name}=${encodeURIComponent(value)}; ${cookieOptions(maxAge)}`)
  res.setHeader('Set-Cookie', cookies)
}

function setGoogleOAuthStateCookie(res, nonce, maxAge = GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS) {
  const production = process.env.NODE_ENV === 'production'
  const current = res.getHeader('Set-Cookie')
  const cookies = Array.isArray(current) ? current : current ? [current] : []
  cookies.push(`${GOOGLE_OAUTH_STATE_COOKIE}=${encodeURIComponent(nonce || '')}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${production ? '; Secure' : ''}`)
  res.setHeader('Set-Cookie', cookies)
}

function issueCsrfToken(res) {
  const token = crypto.randomBytes(32).toString('hex')
  const production = process.env.NODE_ENV === 'production'
  const current = res.getHeader('Set-Cookie')
  const cookies = Array.isArray(current) ? current : current ? [current] : []
  cookies.push(`${CSRF_COOKIE}=${token}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=${production ? 'None' : 'Lax'}${production ? '; Secure' : ''}`)
  res.setHeader('Set-Cookie', cookies)
  return token
}

function clearCookie(res, name) {
  setCookie(res, name, '', 0)
}

function issueAuthSession(res, userId) {
  const token = gerarTokenSessao(userId)
  setCookie(res, AUTH_COOKIE, token, COOKIE_MAX_AGE_SECONDS)
  return token
}

function issuePending2fa(res, userId) {
  const token = gerarTokenPending2fa(userId)
  setCookie(res, PENDING_2FA_COOKIE, token, PENDING_MAX_AGE_SECONDS)
  return token
}

function clearAuthCookies(res) {
  clearCookie(res, AUTH_COOKIE)
  clearCookie(res, PENDING_2FA_COOKIE)
}

function clearPending2faCookie(res) {
  clearCookie(res, PENDING_2FA_COOKIE)
}

function issueGoogleOAuthStateCookie(res, nonce) {
  setGoogleOAuthStateCookie(res, nonce)
}

function clearGoogleOAuthStateCookie(res) {
  setGoogleOAuthStateCookie(res, '', 0)
}

function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const item of header.split(';')) {
    const index = item.indexOf('=')
    if (index < 0) continue
    const key = item.slice(0, index).trim()
    if (key !== name) continue
    try { return decodeURIComponent(item.slice(index + 1)) } catch { return null }
  }
  return null
}

module.exports = {
  AUTH_COOKIE,
  PENDING_2FA_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  CSRF_COOKIE,
  issueAuthSession,
  issuePending2fa,
  clearAuthCookies,
  clearPending2faCookie,
  issueGoogleOAuthStateCookie,
  clearGoogleOAuthStateCookie,
  readCookie,
  issueCsrfToken
}
