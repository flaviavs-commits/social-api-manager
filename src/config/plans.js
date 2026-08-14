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
    cadence: plan.cadence,
    features: plan.features,
  }]))
}

function requirePlanModule(moduleName) {
  return (req, res, next) => {
    // Compatibilidade com tokens/fixtures antigos emitidos antes da coluna
    // de plano existir. Usuários persistidos passam a ter plano pela
    // migration, mas uma sessão legada não deve perder acesso de repente.
    if (!req.user?.plan || req.user?.planUnrestricted === true || req.user?.role === 'admin' || req.user?.role === 'super_admin' || hasPlanModule(req.user.plan, moduleName)) return next()
    const plan = getPlan(req.user?.plan)
    return res.status(403).json({
      erro: `O módulo ${moduleName} não está disponível no plano ${plan.name}.`,
      code: 'PLAN_REQUIRED',
      requiredModule: moduleName,
      currentPlan: normalizePlan(req.user?.plan),
    })
  }
}

module.exports = { PLANS, DEFAULT_PLAN, normalizePlan, getPlan, hasPlanModule, publicPlanCatalog, requirePlanModule }
