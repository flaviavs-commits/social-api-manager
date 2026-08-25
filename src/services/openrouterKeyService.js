const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/keys'
const VALID_LIMIT_RESETS = new Set(['daily', 'weekly', 'monthly'])

function getManagementApiKey() {
  return String(process.env.OPENROUTER_MANAGEMENT_API_KEY || '').trim() || null
}

function buildKeyName(userId) {
  return `meu-ecoo-user-${String(userId).trim()}`
}

function buildCreatePayload(userId) {
  const payload = { name: buildKeyName(userId) }
  const limit = Number(process.env.OPENROUTER_USER_KEY_LIMIT_USD)
  if (Number.isFinite(limit) && limit > 0) {
    payload.limit = limit
    const reset = String(process.env.OPENROUTER_USER_KEY_LIMIT_RESET || '').trim().toLowerCase()
    if (VALID_LIMIT_RESETS.has(reset)) payload.limit_reset = reset
  }
  return payload
}

function extractProviderError(body, status) {
  const message = body?.error?.message || body?.message || `OpenRouter respondeu HTTP ${status}`
  const error = new Error(String(message))
  error.status = Number(status) || 502
  error.code = 'openrouter_key_provision_error'
  return error
}

async function createOpenRouterUserKey({ userId, fetchImpl = globalThis.fetch }) {
  const managementKey = getManagementApiKey()
  if (!managementKey) return null
  if (typeof fetchImpl !== 'function') throw new Error('fetch não está disponível para criar a chave OpenRouter.')

  const response = await fetchImpl(OPENROUTER_KEYS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managementKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildCreatePayload(userId)),
  })

  let body = null
  try { body = await response.json() } catch {}
  if (!response.ok) throw extractProviderError(body, response.status)

  const key = String(body?.key || '').trim()
  if (!key) {
    const error = new Error('OpenRouter não devolveu a nova chave de API.')
    error.status = 502
    error.code = 'openrouter_key_provision_error'
    throw error
  }

  return { key, hash: body?.data?.hash || null, label: body?.data?.label || null }
}

async function findStoredKey(client, userId, decrypt) {
  const { rows } = await client.query(
    `SELECT api_key FROM user_ai_keys WHERE user_id = $1 AND modelo = 'openrouter'`,
    [userId]
  )
  return rows[0]?.api_key ? decrypt(rows[0].api_key) : null
}

// A trava transacional evita duas chaves OpenRouter para o mesmo usuário em
// requisições simultâneas. O banco recebe somente o valor cifrado.
async function getOrCreateOpenRouterUserKey({ pool, userId, encrypt, decrypt }) {
  if (!getManagementApiKey()) return null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`openrouter-user-key:${userId}`])

    const existing = await findStoredKey(client, userId, decrypt)
    if (existing) {
      await client.query('COMMIT')
      return { key: existing, created: false }
    }

    const created = await createOpenRouterUserKey({ userId })
    await client.query(
      `INSERT INTO user_ai_keys (user_id, modelo, api_key, last_four, status)
       VALUES ($1, 'openrouter', $2, $3, 'valid')
       ON CONFLICT (user_id, modelo) DO NOTHING`,
      [userId, encrypt(created.key), created.key.slice(-4)]
    )
    await client.query('COMMIT')
    return { key: created.key, created: true, hash: created.hash, label: created.label }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally {
    client.release()
  }
}

module.exports = { createOpenRouterUserKey, getManagementApiKey, getOrCreateOpenRouterUserKey }
