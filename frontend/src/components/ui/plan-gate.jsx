import { getPlan, minimumPlanForModule } from '../../lib/plans.js'

const MODULE_LABELS = {
  rascunhos: 'Baú de Ideias',
  ai: 'Assistente IA',
  biblioteca: 'Biblioteca de mídia',
  filas: 'Repetidor de posts',
  smartlinks: 'Smartlinks',
  equipe: 'Equipe e aprovações',
  relatorios: 'Relatórios avançados',
}

export function PlanGate({ currentPlan, moduleName }) {
  const current = getPlan(currentPlan)
  const required = minimumPlanForModule(moduleName)
  const label = MODULE_LABELS[moduleName] || 'Este módulo'

  return <section className="page-view"><section className="panel plan-gate"><p className="eyebrow">RECURSO DO PLANO {required.name.toUpperCase()}</p><div className="plan-gate-icon" aria-hidden="true">✦</div><h2>{label}</h2><p>O plano {current.name} não inclui este recurso. Faça upgrade para o plano {required.name} e libere {label.toLowerCase()}.</p><a className="action-button inline-flex" href="/#planos">Conhecer os planos</a></section></section>
}
