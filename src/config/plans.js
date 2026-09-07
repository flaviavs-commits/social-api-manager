const catalog = require('../../config/plans.json')

const PLANS = catalog.plans
const DEFAULT_PLAN = PLANS[catalog.defaultPlan] ? catalog.defaultPlan : Object.keys(PLANS)[0]
const PLAN_ALIASES = Object.freeze({ gratuito: 'basico', criador: 'pro', agencia: 'premium' })
const SUPPORTED_PLATFORMS = Object.freeze(['instagram', 'youtube', 'tiktok', 'facebook'])

function canonicalPlanId(plan) {
  const candidate = PLAN_ALIASES[plan] || plan
  return PLANS[candidate] ? candidate : null
}

function normalizePlan(plan) {
  return canonicalPlanId(plan) || DEFAULT_PLAN
}

function getPlan(plan) {
  return PLANS[normalizePlan(plan)]
}

function getMeuEcooPricing(plan) {
  const selectedPlan = typeof plan === 'string' ? getPlan(plan) : plan || {}
  const basePriceCents = Math.max(Math.round(Number(selectedPlan.meuEcooBasePriceCents) || 0), 0)
  const discountPercent = Math.min(Math.max(Number(selectedPlan.meuEcooDiscountPercent) || 0, 0), 100)
  const discountCents = Math.round(basePriceCents * discountPercent / 100)

  return {
    basePriceCents,
    discountPercent,
    discountCents,
    finalPriceCents: Math.max(basePriceCents - discountCents, 0),
  }
}

function getPlanConnectionLimit(plan) {
  return Number(getPlan(plan).maxConnections) || SUPPORTED_PLATFORMS.length
}

function getPlanPlatforms(plan) {
  const configured = getPlan(plan).availablePlatforms
  return SUPPORTED_PLATFORMS.filter(platform => configured?.includes(platform))
}

function hasPlanModule(plan, moduleName) {
  return getPlan(plan).modules.includes(moduleName)
}

function isPaidPlan(plan) {
  return Number(getPlan(plan).priceCents) > 0
}

function publicPlanCatalog() {
  return Object.fromEntries(Object.entries(PLANS).map(([id, plan]) => [id, {
    id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    checkoutPrice: plan.checkoutPrice,
    priceCents: plan.priceCents,
    currency: plan.currency,
    cadence: plan.cadence,
    meuEcooAccess: plan.meuEcooAccess || 'none',
    meuEcooBasePriceCents: getMeuEcooPricing(plan).basePriceCents,
    meuEcooDiscountPercent: Number(plan.meuEcooDiscountPercent) || 0,
    meuEcooDiscountCents: getMeuEcooPricing(plan).discountCents,
    meuEcooDiscountedPriceCents: getMeuEcooPricing(plan).finalPriceCents,
    meuEcooOffer: plan.meuEcooOffer || 'Sem acesso ao MeuEcoo',
    aiImageLimit: getPlanImageLimit(id),
    maxConnections: getPlanConnectionLimit(id),
    availablePlatforms: getPlanPlatforms(id),
    features: plan.features,
  }]))
}

function getPlanImageLimit(plan) {
  return Math.max(Number(getPlan(plan).aiImageLimit) || 0, 0)
}

function requirePlanModule(moduleName) {
  return (req, res, next) => {
    // Ausência de plano é tratada como o plano padrão, nunca como
    // acesso ilimitado. Assim uma migration incompleta ou um registro antigo
    // não transforma uma falha de configuração em autorização.
    if (req.user?.planUnrestricted === true || req.user?.role === 'admin') return next()
    const currentPlan = normalizePlan(req.user?.plan || DEFAULT_PLAN)
    if (req.user?.planActive === false || !isPaidPlan(currentPlan)) {
      return res.status(402).json({
        erro: 'Confirme o pagamento do seu plano para usar este recurso.',
        code: 'PAYMENT_REQUIRED',
        currentPlan,
      })
    }
    if (hasPlanModule(currentPlan, moduleName)) return next()
    const plan = getPlan(currentPlan)
    return res.status(403).json({
      erro: `O módulo ${moduleName} não está disponível no plano ${plan.name}.`,
      code: 'PLAN_REQUIRED',
      requiredModule: moduleName,
      currentPlan: normalizePlan(req.user?.plan),
    })
  }
}

function requirePaidPlan(req, res, next) {
  if (req.user?.planUnrestricted === true || req.user?.role === 'admin') return next()

  const currentPlan = normalizePlan(req.user?.plan || DEFAULT_PLAN)
  if (req.user?.planActive === false || !isPaidPlan(currentPlan)) {
    return res.status(402).json({
      erro: 'Confirme o pagamento do seu plano para usar este recurso.',
      code: 'PAYMENT_REQUIRED',
      currentPlan,
    })
  }
  return next()
}

module.exports = { PLANS, DEFAULT_PLAN, PLAN_ALIASES, SUPPORTED_PLATFORMS, canonicalPlanId, normalizePlan, getPlan, getMeuEcooPricing, getPlanConnectionLimit, getPlanImageLimit, getPlanPlatforms, hasPlanModule, isPaidPlan, publicPlanCatalog, requirePlanModule, requirePaidPlan }
