import { NETWORK_ORDER, PLAT_LABELS } from '../../lib/analytics-format.js'

const STATUS_ICONS = { verified: '✓', partial: '!', no_data: '○' }

function periodLabel(period) {
  if (!period?.since || !period?.until) return `${period?.days || 'período selecionado'} dias`
  const format = value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')
  return `${format(period.since)} a ${format(period.until)}`
}

function platformEntries(verification, activeNet = null) {
  return NETWORK_ORDER
    .filter(platform => !activeNet || platform === activeNet)
    .map(platform => [platform, verification?.platforms?.[platform]])
    .filter(([, item]) => item && (item.content?.total || item.accounts?.connected || item.status === 'verified'))
}

export function AnalyticsDataVerification({ verification, activeNet = null, sourceErrors = [] }) {
  if (!verification) return null

  const selected = activeNet ? verification.platforms?.[activeNet] : null
  const content = selected?.content || verification.coverage?.content || {}
  const entries = platformEntries(verification, activeNet)
  const status = selected?.status || verification.overall?.status || 'no_data'
  const label = selected?.label || verification.overall?.label || 'Status dos dados'
  const description = selected?.description || verification.overall?.description
  const visibleSourceErrors = sourceErrors.filter(issue => !activeNet || String(issue.source || '').toLowerCase().includes(String(PLAT_LABELS[activeNet] || activeNet).toLowerCase()))

  return <section className={`analytics-data-verification is-${status}`} aria-labelledby="analytics-data-verification-title">
    <div className="analytics-data-verification-heading">
      <div className="analytics-data-verification-title-wrap">
        <span className="analytics-data-verification-icon" aria-hidden="true">{STATUS_ICONS[status] || '○'}</span>
        <div>
          <p className="analytics-kicker">CONFERÊNCIA DOS DADOS</p>
          <h3 id="analytics-data-verification-title">{label}{activeNet ? ` · ${PLAT_LABELS[activeNet] || activeNet}` : ''}</h3>
        </div>
      </div>
      <span className="analytics-data-verification-period">{periodLabel(verification.period)}</span>
    </div>
    <p className="analytics-data-verification-description">{description}</p>
    {visibleSourceErrors.length > 0 && <div className="analytics-data-verification-source-error" role="status"><strong>Também não foi possível conferir:</strong> {visibleSourceErrors.map(issue => `${issue.source}: ${issue.message}`).join(' · ')}</div>}

    <div className="analytics-data-verification-facts">
      <div><strong>{content.percent == null ? '—' : `${content.percent}%`}</strong><span>cobertura de publicações</span><small>{content.withData || 0} de {content.total || 0} com métrica confirmada</small></div>
      <div><strong>{content.withoutData || 0}</strong><span>sem métrica confirmada</span><small>Não entram como zero no cálculo.</small></div>
      <div><strong>{entries.length}</strong><span>redes com fonte</span><small>API conectada ou histórico local.</small></div>
    </div>

    {entries.length > 0 && <div className="analytics-data-verification-platforms">
      {entries.map(([platform, item]) => <article key={platform} className={`analytics-data-verification-platform is-${item.status}`}>
        <div className="analytics-data-verification-platform-title"><strong>{PLAT_LABELS[platform] || platform}</strong><span><i aria-hidden="true">{STATUS_ICONS[item.status] || '○'}</i>{item.label}</span></div>
        <p>{item.description}</p>
        <small>{item.content?.total ? `${item.content.withData}/${item.content.total} publicações com dado` : `${item.accounts?.withAnalytics || 0} conta(s) com analytics`}</small>
      </article>)}
    </div>}

    <details className="analytics-data-verification-help">
      <summary>Como interpretar esta conferência?</summary>
      <p><strong>Dados verificados</strong> significa que a rede respondeu ou que o valor veio de um snapshot local identificado. <strong>Dados parciais</strong> significa que parte das publicações ou consultas não respondeu.</p>
      <p>“—” significa que não existe valor confirmado para aquele indicador. Isso é diferente de zero: zero é um resultado informado pela rede.</p>
      <p>Visualizações são reproduções e podem contar a mesma pessoa mais de uma vez. Seguidores e inscritos são totais por rede, não pessoas únicas.</p>
    </details>
  </section>
}
