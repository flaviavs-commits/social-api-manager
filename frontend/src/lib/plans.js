import catalog from '../../../config/plans.json'

export const PLANS = catalog.plans
export const DEFAULT_PLAN = PLANS[catalog.defaultPlan] ? catalog.defaultPlan : Object.keys(PLANS)[0]

export function normalizePlan(plan) {
  return PLANS[plan] ? plan : DEFAULT_PLAN
}

export function getPlan(plan) {
  return PLANS[normalizePlan(plan)]
}

export function hasPlanModule(plan, moduleName, unrestricted = false) {
  return unrestricted || getPlan(plan).modules.includes(moduleName)
}

export function minimumPlanForModule(moduleName) {
  return Object.values(PLANS).find(plan => plan.modules.includes(moduleName)) || getPlan(DEFAULT_PLAN)
}
