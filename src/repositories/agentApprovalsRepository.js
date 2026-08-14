const pool = require('../db/pool')

async function registrarAprovacao({ nonce, userId, action, args, expiresAt }) {
  await pool.query(
    `INSERT INTO ai_agent_approvals (nonce, user_id, action, arguments, expires_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (nonce) DO NOTHING`,
    [nonce, userId, action, JSON.stringify(args || {}), expiresAt]
  )
}

async function consumirAprovacao({ nonce, userId, action, args }) {
  const { rows } = await pool.query(
    `UPDATE ai_agent_approvals
        SET consumed_at = NOW()
      WHERE nonce=$1 AND user_id=$2 AND action=$3
        AND consumed_at IS NULL AND expires_at > NOW()
        AND arguments = $4::jsonb
      RETURNING nonce`,
    [nonce, userId, action, JSON.stringify(args || {})]
  )
  return rows.length > 0
}

module.exports = { registrarAprovacao, consumirAprovacao }
