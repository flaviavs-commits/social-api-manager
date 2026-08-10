const crypto = require('crypto')
const pool = require('../db/pool')

async function dispatchWebhook(event, data, userId) {
  const { rows } = await pool.query('SELECT id,url,secret FROM webhook_endpoints WHERE user_id=$1 AND active=true AND $2 = ANY(events)', [userId, event])
  await Promise.all(rows.map(async endpoint => {
    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data })
    const signature = crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex')
    try {
      const response = await fetch(endpoint.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MeuEcoo-Event': event, 'X-MeuEcoo-Signature': signature }, body, signal: AbortSignal.timeout(8000) })
      await pool.query('UPDATE webhook_endpoints SET last_status=$1,last_error=NULL WHERE id=$2', [response.status, endpoint.id])
    } catch (error) {
      await pool.query('UPDATE webhook_endpoints SET last_status=NULL,last_error=$1 WHERE id=$2', [String(error.message || 'Falha no webhook').slice(0, 500), endpoint.id]).catch(() => {})
    }
  }))
}

module.exports = { dispatchWebhook }
