import catalog from '../../../config/plans.json'

export const PLANS = catalog.plans
export const DEFAULT_PLAN = PLANS[catalog.defaultPlan] ? catalog.defaultPlan : Object.keys(PLANS)[0]

export function normalizePlan(plan) {
  return PLANS[plan] ? plan : DEFAULT_PLAN
}

export function getPlan(plan) {
  return PLANS[normalizePlan(plan)]
}

export function getMeuEcooPricing(plan) {
  const basePriceCents = Math.max(Math.round(Number(plan?.meuEcooBasePriceCents) || 0), 0)
  const discountPercent = Math.min(Math.max(Number(plan?.meuEcooDiscountPercent) || 0, 0), 100)
  const discountCents = Math.round(basePriceCents * discountPercent / 100)

  return {
    basePriceCents,
    discountPercent,
    discountCents,
    finalPriceCents: Math.max(basePriceCents - discountCents, 0),
  }
}

export function hasPlanModule(plan, moduleName, unrestricted = false) {
  return unrestricted || getPlan(plan).modules.includes(moduleName)
}

export function hasActivePlanModule(plan, moduleName, planActive = true, unrestricted = false) {
  return unrestricted || (planActive !== false && hasPlanModule(plan, moduleName))
}

export function minimumPlanForModule(moduleName) {
  return Object.values(PLANS).find(plan => plan.modules.includes(moduleName)) || getPlan(DEFAULT_PLAN)
}
