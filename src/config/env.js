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
    trustProxy: number(source.TRUST_PROXY, 0)
  })
}

function assertProductionSecrets(source = process.env) {
  const nodeEnv = String(source.NODE_ENV || '').trim().toLowerCase()
  const reviewEnabled = boolean(source.REVIEW_MODE_NO_AUTH) || boolean(source.TIKTOK_REVIEW_MODE)

  // Um modo de revisão sem NODE_ENV explícito não pode ser tratado como
  // desenvolvimento: em um deploy mal configurado isso abriria a API inteira.
  if (!nodeEnv && reviewEnabled) {
    const error = new Error('NODE_ENV deve ser explicitamente configurado quando um modo de revisão estiver ativo')
    error.code = 'CONFIGURATION_ERROR'
    throw error
  }

  if (nodeEnv !== 'production') return

  if (reviewEnabled) {
    const error = new Error('Modos de revisão não podem ser ativados em produção')
    error.code = 'CONFIGURATION_ERROR'
    throw error
  }

  const required = [
    'AUTH_TOKEN_SECRET', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'DATABASE_URL',
    'BASE_URL', 'FRONTEND_URL', 'FRONTEND_ORIGIN', 'CRON_SECRET', 'BLOB_ALLOWED_HOSTS'
  ]
  const missing = required.filter(name => !String(source[name] || '').trim())
  if (missing.length) {
    const error = new Error(`Segredos obrigatórios ausentes: ${missing.join(', ')}`)
    error.code = 'CONFIGURATION_ERROR'
    throw error
  }

  const secrets = ['AUTH_TOKEN_SECRET', 'SESSION_SECRET', 'CRON_SECRET']
  const weak = secrets.filter(name => String(source[name]).length < 32)
  if (!/^[0-9a-f]{64}$/i.test(String(source.TOKEN_ENCRYPTION_KEY || ''))) weak.push('TOKEN_ENCRYPTION_KEY(64 hex)')

  let origins
  try { origins = csv(source.FRONTEND_ORIGIN).map(origin => new URL(origin)) } catch { origins = null }
  const invalidOrigins = !origins?.length || origins.some(origin => origin.protocol !== 'https:')
  if (invalidOrigins) weak.push('FRONTEND_ORIGIN(HTTPS)')

  for (const name of ['BASE_URL', 'FRONTEND_URL']) {
    try {
      if (new URL(source[name]).protocol !== 'https:') weak.push(`${name}(HTTPS)`)
    } catch { weak.push(`${name}(URL)`) }
  }

  if (number(source.TRUST_PROXY, 0) !== 1) weak.push('TRUST_PROXY(1)')

  const blobHosts = csv(source.BLOB_ALLOWED_HOSTS)
  if (!blobHosts.length || blobHosts.some(host => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || host.includes('*'))) {
    weak.push('BLOB_ALLOWED_HOSTS(exatos)')
  }

  if (weak.length) {
    const error = new Error(`Configuração de produção insegura: ${weak.join(', ')}`)
    error.code = 'CONFIGURATION_ERROR'
    throw error
  }
}

module.exports = { DEFAULT_PORT, csv, boolean, readEnv, assertProductionSecrets }
