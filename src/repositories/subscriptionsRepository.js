const pool = require('../db/pool')

// Acesso a dados puro — sem regra de negócio (decidir o que fazer com cada
// status da Stripe, disparar e-mail, revogar acesso etc. é escopo das tasks
// seguintes: "checkout em modo assinatura" e "webhook de ciclo de vida").
// Ver src/db/migrations/077_subscriptions.sql para o raciocínio do schema.

const SUBSCRIPTION_COLUMNS = `
  id,
  user_id AS "userId",
  stripe_subscription_id AS "stripeSubscriptionId",
  stripe_price_id AS "stripePriceId",
  plan,
  status,
  current_period_end AS "currentPeriodEnd",
  cancel_at_period_end AS "cancelAtPeriodEnd",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

async function buscarPorUserId(userId) {
  const { rows: [subscription] } = await pool.query(
    `SELECT ${SUBSCRIPTION_COLUMNS}
       FROM subscriptions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  )
  return subscription || null
}

async function buscarPorStripeSubscriptionId(stripeSubscriptionId) {
  const { rows: [subscription] } = await pool.query(
    `SELECT ${SUBSCRIPTION_COLUMNS}
       FROM subscriptions
      WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  )
  return subscription || null
}

async function criar({ userId, stripeSubscriptionId, stripePriceId, plan, status = 'incomplete', currentPeriodEnd = null, cancelAtPeriodEnd = false }) {
  const { rows: [subscription] } = await pool.query(
    `INSERT INTO subscriptions
      (user_id, stripe_subscription_id, stripe_price_id, plan, status, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (stripe_subscription_id) DO NOTHING
     RETURNING ${SUBSCRIPTION_COLUMNS}`,
    [userId, stripeSubscriptionId, stripePriceId, plan, status, currentPeriodEnd, cancelAtPeriodEnd]
  )
  return subscription || null
}

// Idempotente por stripe_subscription_id: reenvio do mesmo evento da Stripe
// (customer.subscription.updated, por exemplo) só reescreve os mesmos campos.
async function atualizarPorStripeSubscriptionId(stripeSubscriptionId, { status, currentPeriodEnd, cancelAtPeriodEnd, plan, stripePriceId }) {
  const { rows: [subscription] } = await pool.query(
    `UPDATE subscriptions
        SET status = COALESCE($2, status),
            current_period_end = COALESCE($3, current_period_end),
            cancel_at_period_end = COALESCE($4, cancel_at_period_end),
            plan = COALESCE($5, plan),
            stripe_price_id = COALESCE($6, stripe_price_id),
            updated_at = NOW()
      WHERE stripe_subscription_id = $1
     RETURNING ${SUBSCRIPTION_COLUMNS}`,
    [stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd, plan, stripePriceId]
  )
  return subscription || null
}

module.exports = {
  buscarPorUserId,
  buscarPorStripeSubscriptionId,
  criar,
  atualizarPorStripeSubscriptionId,
}
