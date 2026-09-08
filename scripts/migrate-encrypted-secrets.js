/*
 * Re-cifra segredos legados que foram gravados antes do AES-256-GCM.
 * Execute somente após conferir o banco e confirmar explicitamente:
 * CONFIRM_ENCRYPTED_SECRETS_MIGRATION=YES npm run security:migrate-encrypted-secrets
 *
 * A operação é idempotente e nunca imprime os valores dos segredos.
 */
require('dotenv').config()

const pool = require('../src/db/pool')
const { encrypt } = require('../src/services/tokenCrypto')

const PREFIX = 'enc:v1:'

function isLegacy(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith(PREFIX)
}

async function reencryptColumn(client, { table, id, column, value }) {
  if (!isLegacy(value)) return false
  const encrypted = encrypt(value)
  const result = await client.query(
    `UPDATE ${table} SET ${column}=$1 WHERE id=$2 AND ${column}=$3`,
    [encrypted, id, value]
  )
  return result.rowCount === 1
}

async function migrate() {
  if (process.env.CONFIRM_ENCRYPTED_SECRETS_MIGRATION !== 'YES') {
    throw new Error('Defina CONFIRM_ENCRYPTED_SECRETS_MIGRATION=YES para confirmar a migração.')
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.')
  if (!process.env.TOKEN_ENCRYPTION_KEY) throw new Error('TOKEN_ENCRYPTION_KEY não configurada.')

  const client = await pool.connect()
  const counts = { tokens: 0, users: 0, aiKeys: 0, oauthPending: 0 }
  try {
    await client.query('BEGIN')

    const tokens = await client.query('SELECT id, access_token, refresh_token FROM tokens')
    for (const row of tokens.rows) {
      if (await reencryptColumn(client, { table: 'tokens', id: row.id, column: 'access_token', value: row.access_token })) counts.tokens++
      if (await reencryptColumn(client, { table: 'tokens', id: row.id, column: 'refresh_token', value: row.refresh_token })) counts.tokens++
    }

    const users = await client.query('SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL')
    for (const row of users.rows) {
      if (await reencryptColumn(client, { table: 'users', id: row.id, column: 'totp_secret', value: row.totp_secret })) counts.users++
    }

    const aiKeys = await client.query('SELECT id, api_key FROM user_ai_keys')
    for (const row of aiKeys.rows) {
      if (await reencryptColumn(client, { table: 'user_ai_keys', id: row.id, column: 'api_key', value: row.api_key })) counts.aiKeys++
    }

    const pending = await client.query('SELECT id, temp_token, connect_token FROM zernio_oauth_pending')
    for (const row of pending.rows) {
      if (await reencryptColumn(client, { table: 'zernio_oauth_pending', id: row.id, column: 'temp_token', value: row.temp_token })) counts.oauthPending++
      if (await reencryptColumn(client, { table: 'zernio_oauth_pending', id: row.id, column: 'connect_token', value: row.connect_token })) counts.oauthPending++
    }

    await client.query('COMMIT')
    console.log(`Segredos migrados com sucesso: tokens=${counts.tokens}, totp=${counts.users}, ai=${counts.aiKeys}, oauth=${counts.oauthPending}.`)
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch(error => {
  console.error(`Migração de segredos falhou: ${error.message}`)
  process.exitCode = 1
})

