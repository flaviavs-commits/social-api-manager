import { useState } from 'react'

const DISMISS_KEY = 'meu-ecoo:onboarding-dismissed'

export function OnboardingChecklist({ accounts = [], posts = [], onNavigate }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const hasPublishedOrScheduled = posts.some(post => ['published', 'publicado', 'scheduled', 'agendado'].includes(post.status))
  const steps = [
    { label: 'Conecte sua primeira rede', description: 'Escolha onde você quer publicar.', done: accounts.length > 0, page: 'integracoes', action: 'Conectar rede' },
    { label: 'Crie sua primeira publicação', description: 'Escreva o conteúdo e escolha as redes.', done: posts.length > 0, page: 'agendador', action: 'Criar publicação' },
    { label: 'Agende ou publique', description: 'Mantenha seu calendário sempre ativo.', done: hasPublishedOrScheduled, page: 'calendario', action: 'Ver calendário' }
  ]
  const completed = steps.filter(step => step.done).length

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  if (dismissed) return null

  return <section className="onboarding-card" aria-labelledby="onboarding-title">
    <div className="onboarding-heading">
      <div><p className="eyebrow">COMECE POR AQUI</p><h2 id="onboarding-title">Configure seu espaço em poucos passos</h2><p>Complete o checklist para aproveitar melhor o Meu Ecoo.</p></div>
      <button className="onboarding-dismiss" type="button" onClick={dismiss}>Dispensar</button>
    </div>
    <div className="onboarding-progress" aria-label={`${completed} de ${steps.length} etapas concluídas`}><span style={{ width: `${(completed / steps.length) * 100}%` }} /></div>
    <div className="onboarding-steps">
      {steps.map(step => <div className={`onboarding-step${step.done ? ' is-done' : ''}`} key={step.label}>
        <span className="onboarding-step-icon" aria-hidden="true">{step.done ? '✓' : '○'}</span>
        <div><strong>{step.label}</strong><p>{step.description}</p></div>
        {!step.done && <button className="link-button" type="button" onClick={() => onNavigate(step.page)}>{step.action}</button>}
      </div>)}
    </div>
  </section>
}
