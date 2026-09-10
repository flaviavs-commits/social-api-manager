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
  paid_at AS "paidAt",
  meu_ecoo_email_status AS "meuEcooEmailStatus",
  meu_ecoo_email_attempts AS "meuEcooEmailAttempts",
  meu_ecoo_email_sent_at AS "meuEcooEmailSentAt",
  meu_ecoo_email_updated_at AS "meuEcooEmailUpdatedAt",
  meu_ecoo_email_last_error AS "meuEcooEmailLastError",
  meu_ecoo_selected AS "meuEcooSelected",
  meu_ecoo_amount_cents AS "meuEcooAmountCents"
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

// Usado pelo relatório de conciliação: busca em uma única query quais das
// sessões pagas na Stripe já têm cobrança correspondente no banco, evitando
// N+1 consultas ao cruzar uma página inteira de sessões da Stripe.
async function buscarPorGatewaySessions(gatewaySessionIds) {
  if (!Array.isArray(gatewaySessionIds) || gatewaySessionIds.length === 0) return []
  const { rows } = await pool.query(
    `SELECT ${BILLING_COLUMNS}
       FROM billing_plan_changes
      WHERE gateway_session_id = ANY($1::text[])`,
    [gatewaySessionIds]
  )
  return rows
}

async function criarPendente({ userId, fromPlan, toPlan, amountCents, currency, billingMonth, idempotencyKey, gateway, meuEcooSelected = false, meuEcooAmountCents = 0 }) {
  const { rows: [change] } = await pool.query(
    `INSERT INTO billing_plan_changes
      (user_id, from_plan, to_plan, amount_cents, currency, billing_month, idempotency_key, gateway, meu_ecoo_selected, meu_ecoo_amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, billing_month) DO NOTHING
     RETURNING ${BILLING_COLUMNS}`,
    [userId, fromPlan, toPlan, amountCents, currency, billingMonth, idempotencyKey, gateway, Boolean(meuEcooSelected), Math.max(Number(meuEcooAmountCents) || 0, 0)]
  )
  return change || null
}

async function atualizarItensMeuEcoo(id, { amountCents, meuEcooSelected = false, meuEcooAmountCents = 0 }) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET amount_cents = $2,
            meu_ecoo_selected = $3,
            meu_ecoo_amount_cents = $4,
            updated_at = NOW()
      WHERE id = $1
        AND gateway_session_id IS NULL
        AND status IN ('pending', 'failed')
     RETURNING ${BILLING_COLUMNS}`,
    [id, amountCents, Boolean(meuEcooSelected), Math.max(Number(meuEcooAmountCents) || 0, 0)]
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
      const divergencia = new Error('A cobrança confirmada não corresponde ao valor ou moeda registrados.')
      divergencia.code = 'amount_mismatch'
      throw divergencia
    }
    if (toPlan && change.toPlan !== toPlan) {
      const divergencia = new Error('A cobrança confirmada não corresponde ao plano registrado.')
      divergencia.code = 'plan_mismatch'
      throw divergencia
    }

    const { rows: [paidChange] } = await client.query(
      `UPDATE billing_plan_changes
          SET status = 'paid', gateway_payment_id = COALESCE($2, gateway_payment_id),
              failure_code = NULL, failure_message = NULL, paid_at = COALESCE(paid_at, NOW()),
              meu_ecoo_email_status = CASE
                WHEN to_plan IN ('pro', 'premium') AND meu_ecoo_email_status IS NULL THEN 'pending'
                ELSE meu_ecoo_email_status
              END,
              updated_at = NOW()
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

// Confirma um pagamento feito diretamente por um Payment Link estático da
// Stripe (sem passar pelo checkout dinâmico do app, portanto sem uma linha
// pendente em billing_plan_changes). O client_reference_id do link identifica
// o usuário; o valor cobrado identifica o plano. Idempotente por
// gateway_session_id: uma reentrega do webhook encontra a linha já criada.
async function confirmarPagamentoDireto({ userId, fromPlan, toPlan, amountCents, currency, billingMonth, gatewaySessionId, gatewayPaymentId }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [existing] } = await client.query(
      `SELECT ${BILLING_COLUMNS} FROM billing_plan_changes WHERE gateway_session_id = $1 FOR UPDATE`,
      [gatewaySessionId]
    )
    if (existing) {
      await client.query('COMMIT')
      return existing
    }

    const idempotencyKey = `direct-link-${gatewaySessionId}`
    const { rows: [change] } = await client.query(
      `INSERT INTO billing_plan_changes
        (user_id, from_plan, to_plan, amount_cents, currency, billing_month, idempotency_key, gateway,
         gateway_session_id, gateway_payment_id, status, paid_at,
         meu_ecoo_email_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'stripe', $8, $9, 'paid', NOW(),
         CASE WHEN $3 IN ('pro', 'premium') THEN 'pending' ELSE NULL END)
       ON CONFLICT (user_id, billing_month) DO NOTHING
       RETURNING ${BILLING_COLUMNS}`,
      [userId, fromPlan, toPlan, amountCents, currency, billingMonth, idempotencyKey, gatewaySessionId, gatewayPaymentId || null]
    )

    if (!change) {
      // Já existe uma cobrança registrada para este usuário neste mês (feita
      // pelo fluxo normal do app). Não sobrescrevemos: a reconciliação
      // precisa ser manual para não arriscar duplicar/errar o plano.
      await client.query('ROLLBACK')
      return null
    }

    await client.query(
      `UPDATE users SET plan = $1, plan_active = TRUE, plan_unrestricted = FALSE WHERE id = $2 AND ativo = TRUE`,
      [toPlan, userId]
    )
    await client.query('COMMIT')
    return change
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

// A confirmação do pagamento pode chegar mais de uma vez. A reserva atômica
// abaixo faz com que somente uma tentativa de envio do benefício seja feita
// por vez, permitindo retomar uma tentativa que caiu antes de ser concluída.
async function reservarEnvioMeuEcoo(id) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET meu_ecoo_email_status = 'sending',
            meu_ecoo_email_attempts = COALESCE(meu_ecoo_email_attempts, 0) + 1,
            meu_ecoo_email_updated_at = NOW(),
            meu_ecoo_email_last_error = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'paid'
        AND to_plan IN ('pro', 'premium')
        AND (
          meu_ecoo_email_status IS NULL
          OR meu_ecoo_email_status = 'pending'
          OR meu_ecoo_email_status = 'failed'
          OR (
            meu_ecoo_email_status = 'sending'
            AND (meu_ecoo_email_updated_at IS NULL OR meu_ecoo_email_updated_at < NOW() - INTERVAL '10 minutes')
          )
        )
     RETURNING ${BILLING_COLUMNS}`,
    [id]
  )
  return change || null
}

async function marcarEnvioMeuEcooConcluido(id) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET meu_ecoo_email_status = 'sent',
            meu_ecoo_email_sent_at = COALESCE(meu_ecoo_email_sent_at, NOW()),
            meu_ecoo_email_updated_at = NOW(),
            meu_ecoo_email_last_error = NULL,
            updated_at = NOW()
      WHERE id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [id]
  )
  return change || null
}

async function marcarFalhaEnvioMeuEcoo(id, message) {
  const { rows: [change] } = await pool.query(
    `UPDATE billing_plan_changes
        SET meu_ecoo_email_status = 'failed',
            meu_ecoo_email_updated_at = NOW(),
            meu_ecoo_email_last_error = $2,
            updated_at = NOW()
      WHERE id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [id, String(message || 'Falha ao enviar o acesso ao MeuEcoo.').slice(0, 500)]
  )
  return change || null
}

module.exports = {
  buscarPorMes,
  buscarPorGatewaySession,
  buscarPorGatewaySessions,
  criarPendente,
  atualizarItensMeuEcoo,
  reservarProcessamento,
  anexarCheckout,
  marcarFalha,
  manterProcessando,
  confirmarPagamento,
  confirmarPagamentoDireto,
  marcarFalhaPorSession,
  reservarEnvioMeuEcoo,
  marcarEnvioMeuEcooConcluido,
  marcarFalhaEnvioMeuEcoo,
}
