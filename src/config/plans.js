const catalog = require('../../config/plans.json')

const PLANS = catalog.plans
const DEFAULT_PLAN = PLANS[catalog.defaultPlan] ? catalog.defaultPlan : Object.keys(PLANS)[0]

function normalizePlan(plan) {
  return PLANS[plan] ? plan : DEFAULT_PLAN
}

function getPlan(plan) {
  return PLANS[normalizePlan(plan)]
}

function hasPlanModule(plan, moduleName) {
  return getPlan(plan).modules.includes(moduleName)
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
    features: plan.features,
  }]))
}

function requirePlanModule(moduleName) {
  return (req, res, next) => {
    // Ausência de plano é tratada como o plano padrão (gratuito), nunca como
    // acesso ilimitado. Assim uma migration incompleta ou um registro antigo
    // não transforma uma falha de configuração em autorização.
    if (req.user?.planUnrestricted === true || req.user?.role === 'admin' || req.user?.role === 'super_admin') return next()
    const currentPlan = normalizePlan(req.user?.plan || DEFAULT_PLAN)
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

module.exports = { PLANS, DEFAULT_PLAN, normalizePlan, getPlan, hasPlanModule, publicPlanCatalog, requirePlanModule }
