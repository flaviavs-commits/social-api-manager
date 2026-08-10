/*
 * Executa a migration de tokens de reset somente em um PostgreSQL local.
 * A recusa explícita de hosts remotos evita aplicar uma migration destrutiva
 * no Railway/Vercel por engano.
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal'])
const connectionString = process.env.DATABASE_URL || ''

let parsed
try {
  parsed = new URL(connectionString)
} catch {
  console.error('DATABASE_URL ausente ou inválida.')
  process.exit(1)
}

if (!localHosts.has(parsed.hostname.toLowerCase())) {
  console.error(`Migration recusada: DATABASE_URL aponta para host não local (${parsed.hostname}).`)
  console.error('Defina DATABASE_URL temporariamente para um PostgreSQL local e execute novamente.')
  process.exit(2)
}

const migrationPath = path.join(__dirname, '..', 'src', 'db', 'migrations', '044_security_reset_tokens.sql')
const sql = fs.readFileSync(migrationPath, 'utf8')
const client = new Client({ connectionString })

client.connect()
  .then(() => client.query('BEGIN'))
  .then(() => client.query(sql))
  .then(() => client.query('COMMIT'))
  .then(() => console.log('Migration 044 aplicada no banco local.'))
  .catch(async error => {
    try { await client.query('ROLLBACK') } catch {}
    console.error('Migration local falhou:', error.message)
    process.exitCode = 1
  })
  .finally(() => client.end())

