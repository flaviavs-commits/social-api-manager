const DEFAULT_PORT = 3000

function csv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function boolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function number(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readEnv(source = process.env) {
  const nodeEnv = source.NODE_ENV || 'development'
  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: number(source.PORT, DEFAULT_PORT),
    baseUrl: String(source.BASE_URL || '').replace(/\/$/, ''),
    frontendUrl: String(source.FRONTEND_URL || '').replace(/\/$/, ''),
    allowedOrigins: csv(source.FRONTEND_ORIGIN),
    reviewMode: boolean(source.REVIEW_MODE_NO_AUTH),
    tiktokReviewMode: boolean(source.TIKTOK_REVIEW_MODE),
    trustProxy: number(source.TRUST_PROXY, 1)
  })
}

function assertProductionSecrets(source = process.env) {
  if ((source.NODE_ENV || 'development') !== 'production') return

  const required = ['AUTH_TOKEN_SECRET', 'TOKEN_ENCRYPTION_KEY', 'DATABASE_URL']
  const missing = required.filter(name => !String(source[name] || '').trim())
  if (missing.length) {
    const error = new Error(`Segredos obrigatórios ausentes: ${missing.join(', ')}`)
    error.code = 'CONFIGURATION_ERROR'
    throw error
  }
}

module.exports = { DEFAULT_PORT, csv, boolean, readEnv, assertProductionSecrets }
