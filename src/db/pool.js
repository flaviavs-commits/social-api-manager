const { Pool, types } = require('pg')
const tls = require('tls')

// Colunas "timestamp without time zone" são gravadas em UTC (NOW() do Postgres
// está em UTC). Por padrão o driver as interpreta como horário local do
// processo Node, o que adianta as datas em 3h. Forçamos a leitura como UTC.
types.setTypeParser(types.builtins.TIMESTAMP, str => str ? new Date(str + 'Z') : null)

const postgresCa = process.env.PGSSL_CA_B64
  ? (() => {
      const der = Buffer.from(process.env.PGSSL_CA_B64, 'base64')
      const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') || ''
      return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`
    })()
  : String(process.env.PGSSL_CA || '').replace(/\\n/g, '\n')
const postgresFingerprint = String(process.env.PGSSL_SERVER_FINGERPRINT || '').replace(/[^a-f0-9]/gi, '').toUpperCase()

function checkPostgresCertificate(hostname, certificate) {
  if (postgresFingerprint && certificate?.fingerprint256) {
    const actual = certificate.fingerprint256.replace(/[^a-f0-9]/gi, '').toUpperCase()
    return actual === postgresFingerprint ? undefined : new Error('Fingerprint TLS do PostgreSQL não corresponde')
  }
  return tls.checkServerIdentity(hostname, certificate)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Nunca desabilitar a validação do certificado em produção. Se a
  // implantação usa uma CA privada, forneça PGSSL_CA em vez de aceitar
  // qualquer certificado apresentado pelo servidor.
  ssl: process.env.NODE_ENV === 'production'
    ? {
        rejectUnauthorized: true,
        ...(postgresCa ? { ca: postgresCa } : {}),
        ...(postgresFingerprint ? { checkServerIdentity: checkPostgresCertificate } : {})
      }
    : undefined,
  // Default do driver é max=10, o que esgota rápido com várias chamadas
  // paralelas (dashboard, analytics) concorrendo pela mesma conexão. Subido
  // para 30 depois que a publicação multi-plataforma/multi-post passou a
  // rodar em paralelo (publisher.js, scheduler.js), aumentando o pico de
  // queries concorrentes por publicação.
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30000),
  query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 35000)
})

module.exports = pool
