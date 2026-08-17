const pool = require('../../db/pool')

// express-rate-limit chama increment() para cada chave/IP. Em produção a
// chave precisa viver fora do processo para funcionar com várias réplicas.
class PostgresRateLimitStore {
  constructor(prefix) {
    this.prefix = String(prefix || 'api')
    this.localKeyPrefix = `${this.prefix}:`
  }

  init(options) {
    this.windowMs = Number(options?.windowMs || 60_000)
  }

  async increment(key) {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.windowMs)
    const storageKey = `${this.localKeyPrefix}${key}`
    const { rows: [row] } = await pool.query(`
      INSERT INTO rate_limit_counters (key, hits, expires_at)
      VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_counters.expires_at <= $3 THEN 1 ELSE rate_limit_counters.hits + 1 END,
        expires_at = CASE WHEN rate_limit_counters.expires_at <= $3 THEN $2 ELSE rate_limit_counters.expires_at END
      RETURNING hits, expires_at
    `, [storageKey, expiresAt, now])

    return {
      totalHits: Number(row?.hits || 0),
      resetTime: row?.expires_at ? new Date(row.expires_at) : expiresAt
    }
  }

  async decrement(key) {
    await pool.query(
      'UPDATE rate_limit_counters SET hits = GREATEST(hits - 1, 0) WHERE key = $1',
      [`${this.localKeyPrefix}${key}`]
    )
  }

  async resetKey(key) {
    await pool.query('DELETE FROM rate_limit_counters WHERE key = $1', [`${this.localKeyPrefix}${key}`])
  }

  async shutdown() {
    // O pool é compartilhado pela aplicação e não deve ser encerrado aqui.
  }
}

function createRateLimitStore(prefix) {
  const explicitPostgres = String(process.env.RATE_LIMIT_STORE || '').toLowerCase() === 'postgres'
  if (process.env.NODE_ENV !== 'production' && !explicitPostgres) return undefined
  return new PostgresRateLimitStore(prefix)
}

module.exports = { PostgresRateLimitStore, createRateLimitStore }
