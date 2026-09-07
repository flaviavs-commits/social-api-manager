const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { createRateLimitStore } = require('../infra/http/postgresRateLimitStore')
const { addLog } = require('../middleware/logger')
const paymentGateway = require('../services/billing/paymentGateway')
const billingService = require('../services/billing/billingService')

const router = Router()
const planChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('billing'),
  message: { erro: 'Muitas tentativas de troca de plano. Aguarde alguns minutos.' },
})

router.get('/status', async (req, res) => {
  try {
    res.json(await billingService.getStatus({ userId: req.user.id, currentPlan: req.user.plan, planActive: req.user.planActive }))
  } catch (error) {
    await addLog('err', `Falha ao carregar status de cobrança: ${error.message}`, null, null, req.user.id)
    res.status(500).json({ erro: 'Não foi possível carregar o status da cobrança agora.' })
  }
})

router.post('/plan-change', planChangeLimiter, async (req, res) => {
  try {
    const result = await billingService.requestPlanChange({ user: req.user, targetPlan: req.body?.plan, meuEcoo: req.body?.meuEcoo })
    return res.status(result.httpStatus || 200).json({
      ok: result.status !== 'failed',
      status: result.status,
      plan: result.plan,
      requestedPlan: result.requestedPlan,
      charged: result.charged,
      checkoutUrl: result.checkoutUrl,
      meuEcooSelected: result.meuEcooSelected === true,
      meuEcooAmountCents: Number(result.meuEcooAmountCents) || 0,
      billingMonth: result.billingMonth || null,
      charge: result.charge || null,
    })
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500
    const publicMessage = error.code === 'payment_gateway_not_configured'
      ? 'O gateway de pagamento ainda não está configurado.'
      : error.code === 'payment_gateway_unsupported'
        ? 'O gateway de pagamento configurado não é suportado.'
        : error.code === 'monthly_charge_exists' || error.code === 'monthly_charge_attempted'
          ? error.message
          : error.code === 'invalid_plan'
            ? 'Plano selecionado inválido.'
            : 'Não foi possível iniciar a troca de plano agora.'
    await addLog('err', `Falha na troca de plano: ${error.message}`, null, null, req.user.id)
    return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ erro: publicMessage, code: error.code || 'billing_error' })
  }
})

async function handleStripeWebhook(req, res) {
  try {
    const event = paymentGateway.verifyWebhook(req.body, req.get('stripe-signature'))
    const result = await billingService.handleWebhook(event)
    return res.json({ received: true, status: result.status })
  } catch (error) {
    await addLog('err', `Falha no webhook de cobrança: ${error.message}`)
    if (error.code === 'invalid_webhook_signature' || error.code === 'invalid_webhook_payload') {
      return res.status(400).json({ erro: 'Webhook inválido.' })
    }
    return res.status(Number(error.statusCode) >= 400 && Number(error.statusCode) < 500 ? Number(error.statusCode) : 500).json({ erro: 'Não foi possível processar o webhook agora.' })
  }
}

module.exports = { router, handleStripeWebhook }
