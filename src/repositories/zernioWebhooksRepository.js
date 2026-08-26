const pool = require('../db/pool')

async function enfileirar({ eventId, eventName, payload }) {
  const { rows } = await pool.query(`
    INSERT INTO zernio_webhook_events (event_id, event_name, payload)
    VALUES ($1, $2, $3::jsonb)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING id, event_id AS "eventId"
  `, [eventId, eventName, JSON.stringify(payload)])
  return rows[0] || null
}

async function reservar(id) {
  const { rows } = await pool.query(`
    UPDATE zernio_webhook_events
       SET status = 'processing',
           attempts = attempts + 1,
           next_attempt_at = NOW() + INTERVAL '1 minute'
     WHERE id = $1
       AND (
         status = 'pending'
         OR (status = 'processing' AND (next_attempt_at IS NULL OR next_attempt_at < NOW()))
       )
     RETURNING id, event_id AS "eventId", event_name AS "eventName", payload, attempts
  `, [id])
  return rows[0] || null
}

async function listarPendentes(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 50))
  const { rows } = await pool.query(`
    SELECT id, event_id AS "eventId", event_name AS "eventName", payload, attempts
    FROM zernio_webhook_events
    WHERE status = 'pending'
       OR (status = 'processing' AND (next_attempt_at IS NULL OR next_attempt_at < NOW()))
    ORDER BY received_at ASC
    LIMIT $1
  `, [safeLimit])
  return rows
}

async function marcarProcessado(id) {
  await pool.query(`
    UPDATE zernio_webhook_events
       SET status = 'processed', last_error = NULL, next_attempt_at = NULL, processed_at = NOW()
     WHERE id = $1
  `, [id])
}

async function devolverParaFila(id, error) {
  await pool.query(`
    UPDATE zernio_webhook_events
       SET status = 'pending', last_error = $2, next_attempt_at = NOW() + INTERVAL '1 minute'
     WHERE id = $1
  `, [id, String(error?.message || error || 'Falha ao processar webhook').slice(0, 1000)])
}

module.exports = { enfileirar, reservar, listarPendentes, marcarProcessado, devolverParaFila }
