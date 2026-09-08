import { useEffect } from 'react'

const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }

export function PublicationStatusModal({ status, platforms, progress, onReview, onClose }) {
  const hasStatus = Boolean(status)

  useEffect(() => {
    if (!hasStatus) return undefined

    const body = document.body
    const previousOverflow = body.style.overflow
    const previousPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`

    return () => {
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPaddingRight
    }
  }, [hasStatus])

  if (!status) return null

  const isProcessing = status.type === 'processing'
  const isSuccess = status.type === 'success'
  const isScheduled = status.type === 'scheduled'
  const isWarning = status.type === 'warning'
  const title = isProcessing
    ? 'Publicando seu post'
    : isSuccess
      ? 'Publicação confirmada'
      : isScheduled
        ? 'Seu post está na agenda'
        : isWarning
          ? 'Publicação parcial'
          : 'Não foi possível concluir a publicação'
  const kicker = isProcessing
    ? 'PUBLICAÇÃO EM ANDAMENTO'
    : isSuccess || isScheduled
      ? 'TUDO CERTO!'
      : 'PRECISA DE ATENÇÃO'
  const platformList = [...new Set((platforms || []).map(platform => PLATFORM_LABELS[platform] || platform))]

  return <div
    className={`modal-overlay scheduler-publication-overlay scheduler-publication-${status.type}`}
    role="presentation"
    onMouseDown={event => { if (!isProcessing && event.target === event.currentTarget) onClose() }}
  >
    <section className="modal-content scheduler-publication-modal" role="dialog" aria-modal="true" aria-labelledby="scheduler-publication-title" aria-describedby="scheduler-publication-description">
      <div className="scheduler-publication-modal-header">
        <div className="scheduler-publication-icon" aria-hidden="true">
          {isProcessing ? <span className="scheduler-publication-spinner"/> : isSuccess || isScheduled ? '✓' : '!'}
        </div>
        <div className="scheduler-publication-heading">
          <p className="scheduler-publication-kicker">{kicker}</p>
          <h2 id="scheduler-publication-title">{title}</h2>
        </div>
        {!isProcessing && <button type="button" className="scheduler-publication-close" onClick={onClose} aria-label="Fechar confirmação">×</button>}
      </div>

      <p id="scheduler-publication-description" className="scheduler-publication-description">
        {isProcessing
          ? progress || status.message
          : isScheduled
            ? <>Ele será publicado em <strong>{status.date || 'o horário escolhido'}</strong>.</>
            : isSuccess
              ? 'A publicação foi confirmada pelo Meu Post e já foi enviada para as redes selecionadas.'
              : status.message}
      </p>

      {isProcessing
        ? <div className="scheduler-publication-waiting" role="status" aria-live="polite">
            <div className="scheduler-publication-progress-track" aria-hidden="true"><span/></div>
            <span>Estamos aguardando a confirmação das redes sociais.</span>
          </div>
        : isScheduled
          ? <div className="scheduler-publication-schedule-details">
              <p className="scheduler-publication-schedule-label">Redes selecionadas</p>
              <div className="scheduler-publication-platforms">{(status.platformList?.length ? status.platformList : platformList).map(platform => <span key={platform}>✓ {platform}</span>)}</div>
              <p className="scheduler-publication-hint">Você pode acompanhar ou editar esse agendamento no calendário.</p>
            </div>
        : <div className="scheduler-publication-result">
            {status.resultSummary?.published?.length > 0 && <div className="scheduler-result-group is-published"><strong>Publicadas</strong>{status.resultSummary.published.map(label => <span key={label}>✓ {label}</span>)}</div>}
            {status.resultSummary?.failures?.length > 0 && <div className="scheduler-result-group is-failed"><strong>Não publicadas</strong>{status.resultSummary.failures.map(item => <span key={`${item.label}-${item.error}`}><b>{item.label}</b><small>{item.error}</small></span>)}</div>}
            {!status.resultSummary && platformList.length > 0 && <div className="scheduler-publication-platforms">{platformList.map(platform => <span key={platform}>✓ {platform}</span>)}</div>}
          </div>}

      {!isProcessing && <div className="scheduler-publication-actions">
      {(isWarning || status.type === 'error') && <button type="button" className="scheduler-feedback-primary" onClick={onReview}>Revisar no Meu Post</button>}
        <button type="button" className="scheduler-feedback-secondary" onClick={onClose}>{isSuccess || isScheduled ? 'Fechar confirmação' : 'Fechar aviso'}</button>
      </div>}
    </section>
  </div>
}
