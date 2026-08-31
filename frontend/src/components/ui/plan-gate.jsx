import { getPlan, minimumPlanForModule } from '../../lib/plans.js'

const MODULE_LABELS = {
  rascunhos: 'Baú de Ideias',
  ai: 'Assistente IA',
  biblioteca: 'Sua biblioteca de mídia',
  filas: 'Repetidor de posts',
  smartlinks: 'Smartlinks',
  equipe: 'Equipe e aprovações',
  relatorios: 'Relatórios avançados',
}

export function PlanGate({ currentPlan, moduleName, planActive = true }) {
  const current = getPlan(currentPlan)
  const required = minimumPlanForModule(moduleName)
  const label = MODULE_LABELS[moduleName] || 'Este módulo'
  const paymentPending = planActive === false

  return <section className="page-view"><section className="panel plan-gate"><p className="eyebrow">{paymentPending ? 'PAGAMENTO PENDENTE' : `RECURSO DO PLANO ${required.name.toUpperCase()}`}</p><div className="plan-gate-icon" aria-hidden="true">✦</div><h2>{paymentPending ? 'Escolha um plano para começar' : label}</h2><p>{paymentPending ? 'Seu perfil está pronto. Escolha o plano Básico, Pro ou Premium e conclua o pagamento para liberar os recursos da plataforma.' : `O plano ${current.name} não inclui este recurso. Faça upgrade para o plano ${required.name} e libere ${label.toLowerCase()}.`}</p><a className="action-button inline-flex" href="/app/perfil">{paymentPending ? 'Escolher plano' : 'Conhecer os planos'}</a></section></section>
}
