const pool = require('../db/pool')

const BILLING_COLUMNS = `
  id,
  user_id AS "userId",
  from_plan AS "fromPlan",
  to_plan AS "toPlan",
  amount_cents AS "amountCents",
  currency,
  billing_month AS "billingMonth",
  idempotency_key AS "idempotencyKey",
  gateway,
  gateway_session_id AS "gatewaySessionId",
  gateway_payment_id AS "gatewayPaymentId",
  status,
  checkout_url AS "checkoutUrl",
  failure_code AS "failureCode",
  failure_message AS "failureMessage",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  paid_at AS "paidAt"
`

async function buscarPorMes(userId, billingMonth) {
  const { rows: [change] } = await pool.query(
    `SELECT ${BILLING_COLUMNS}
       FROM billing_plan_changes
      WHERE user_id = $1 AND billing_month = $2`,
    [userId, billingMonth]
  )
  return change || null
}

async function buscarPorGatewaySession(gatewaySessionId) {
  const { rows: [change] } = await pool.query(
    `SELECT ${BILLING_COLUMNS}
       FROM billing_plan_changes
      WHERE gateway_session_id = $1`,
    [gatewaySessionId]
  )
  return change || null
}

async function criarPendente({ userId, fromPlan, toPlan, amountCents, currency, billingMonth, idempotencyKey, gateway }) {
  const { rows: [change] } = await pool.query(
    `INSERT INTO billing_plan_changes
      (user_id, from_plan, to_plan, amount_cents, currency, billing_month, idempotency_key, gateway)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, billing_month) DO NOTHING
     RETURNING ${BILLING_COLUMNS}`,
    [userId, fromPlan, toPlan, amountCents, currency, billingMonth, idempotencyKey, gateway]
  )
  return change || null
}

// Apenas uma requisição pode reservar a chamada ao gateway. A janela de cinco
// minutos permite retomar uma tentativa que perdeu a resposta HTTP; a mesma
// idempotencyKey continua sendo enviada ao gateway para impedir duplicação.
async function reservarProcessamento(id) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET status = 'processing', failure_code = NULL, failure_message = NULL, updated_at = NOW()
      WHERE id = $1
        AND gateway_session_id IS NULL
        AND (
          status IN ('pending', 'failed')
          OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes')
        )
     RETURNING ${BILLING_COLUMNS}`,
    [id]
  )
  return change || null
}

async function anexarCheckout(id, { gatewaySessionId, checkoutUrl }) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET status = 'pending', gateway_session_id = $2, checkout_url = $3, updated_at = NOW()
      WHERE id = $1 AND status = 'processing' AND gateway_session_id IS NULL
     RETURNING ${BILLING_COLUMNS}`,
    [id, gatewaySessionId, checkoutUrl]
  )
  return change || null
}

async function marcarFalha(id, { code = 'gateway_error', message = 'Falha ao iniciar o checkout.' } = {}) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET status = 'failed', failure_code = $2, failure_message = $3, updated_at = NOW()
      WHERE id = $1 AND status <> 'paid'
     RETURNING ${BILLING_COLUMNS}`,
    [id, String(code).slice(0, 120), String(message).slice(0, 500)]
  )
  return change || null
}

async function manterProcessando(id) {
  await pool.query(
    `UPDATE billing_plan_changes
        SET status = 'processing', updated_at = NOW()
      WHERE id = $1 AND status <> 'paid'`,
    [id]
  )
}

// Confirma a cobrança e altera o plano dentro da mesma transação. Webhooks
// repetidos encontram status = paid e não executam uma segunda alteração.
async function confirmarPagamento({ gatewaySessionId, gatewayPaymentId, amountCents, currency, toPlan }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [change] } = await client.query(
      `SELECT ${BILLING_COLUMNS}
         FROM billing_plan_changes
        WHERE gateway_session_id = $1
        FOR UPDATE`,
      [gatewaySessionId]
    )

    if (!change) {
      await client.query('COMMIT')
      return null
    }
    if (change.status === 'paid') {
      await client.query('COMMIT')
      return change
    }
    if (change.status === 'cancelled' || change.status === 'failed') {
      await client.query('COMMIT')
      return change
    }
    if (Number(change.amountCents) !== Number(amountCents) || String(change.currency).toLowerCase() !== String(currency).toLowerCase()) {
      throw new Error('A cobrança confirmada não corresponde ao valor ou moeda registrados.')
    }
    if (toPlan && change.toPlan !== toPlan) {
      throw new Error('A cobrança confirmada não corresponde ao plano registrado.')
    }

    const { rows: [paidChange] } = await client.query(
      `UPDATE billing_plan_changes
          SET status = 'paid', gateway_payment_id = COALESCE($2, gateway_payment_id),
              failure_code = NULL, failure_message = NULL, paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
        WHERE id = $1
       RETURNING ${BILLING_COLUMNS}`,
      [change.id, gatewayPaymentId || null]
    )
    await client.query(
      `UPDATE users SET plan = $1, plan_active = TRUE, plan_unrestricted = FALSE WHERE id = $2 AND ativo = TRUE`,
      [change.toPlan, change.userId]
    )
    await client.query('COMMIT')
    return paidChange || change
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function marcarFalhaPorSession(gatewaySessionId, { code = 'payment_failed', message = 'O gateway não confirmou o pagamento.' } = {}) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET status = 'failed', failure_code = $2, failure_message = $3, updated_at = NOW()
      WHERE gateway_session_id = $1 AND status <> 'paid'
     RETURNING ${BILLING_COLUMNS}`,
    [gatewaySessionId, String(code).slice(0, 120), String(message).slice(0, 500)]
  )
  return change || null
}

module.exports = {
  buscarPorMes,
  buscarPorGatewaySession,
  criarPendente,
  reservarProcessamento,
  anexarCheckout,
  marcarFalha,
  manterProcessando,
  confirmarPagamento,
  marcarFalhaPorSession,
}
