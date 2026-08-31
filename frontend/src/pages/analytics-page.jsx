import '../lib/chart-setup.js'
import { useState } from 'react'
import { useAnalytics } from '../hooks/use-analytics.js'
import { AnalyticsSummary } from '../components/analytics/analytics-summary.jsx'
import { AnalyticsSidebar } from '../components/analytics/analytics-sidebar.jsx'
import { AnalyticsPanel } from '../components/analytics/analytics-panel.jsx'
import { filterByPeriod, PLAT_LABELS, fmtNum } from '../lib/analytics-format.js'
import { useToast } from '../components/ui/toast.jsx'
import { AnalyticsAccountProfiles } from '../components/analytics/analytics-account-profiles.jsx'
import { AnalyticsExecutiveOverview } from '../components/analytics/analytics-executive-overview.jsx'
import { buildPerformanceReport, performanceReportActions, performanceReportConclusion } from '../components/analytics/analytics-performance-report.jsx'
import { ReportSchedulePanel } from '../components/analytics/report-schedule-panel.jsx'

function csvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function reportRows(data, periodDays, activeNet) {
  return filterByPeriod(data.metrics, periodDays).filter(item => !activeNet || item.platform === activeNet)
}

function sumKnown(values) {
  const known = values.filter(value => value != null && Number.isFinite(Number(value)))
  return known.length ? known.reduce((total, value) => total + Number(value), 0) : null
}

function htmlValue(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export function AnalyticsPage() {
  const [comparePeriod, setComparePeriod] = useState(false)
  const [reportAccountId, setReportAccountId] = useState(null)
  const {
    data, accounts, tiktokVideos, networks, activeNet, activeTab, periodDays,
    loading, error, lastUpdated, setActiveTab, setPeriodDays, selectNetwork,
  } = useAnalytics({ comparePeriod })
  const notify = useToast()
  const selectedPlatform = activeNet === 'all' ? null : activeNet
  const selectedRows = reportRows(data, periodDays, selectedPlatform)
  const selectedViews = sumKnown(selectedRows.map(item => item.metrics?.views))
  const selectedEngagement = sumKnown(selectedRows.map(item => sumKnown([
    item.metrics?.likes,
    item.metrics?.comments,
    item.metrics?.shares,
  ])))
  const performanceReport = buildPerformanceReport(data, tiktokVideos, periodDays, selectedPlatform)

  function openAccountReport(platform, accountId) {
    setReportAccountId(accountId)
    selectNetwork(platform)
    window.setTimeout(() => document.getElementById('analytics-account-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  function exportReport() {
    const rows = reportRows(data, periodDays, selectedPlatform)
    const header = ['Data', 'Rede', 'Publicação', 'Visualizações', 'Curtidas', 'Comentários', 'Compartilhamentos', 'Salvamentos']
    const lines = rows.map(item => [
      item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('pt-BR') : '',
      PLAT_LABELS[item.platform] || item.platform,
      item.text || item.youtubeTitle || '',
      item.metrics?.views ?? '',
      item.metrics?.likes ?? '',
      item.metrics?.comments ?? '',
      item.metrics?.shares ?? '',
      item.metrics?.saves ?? '',
    ].map(csvValue).join(';'))
    const csv = `\uFEFF${[header.map(csvValue).join(';'), ...lines].join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `relatorio-${selectedPlatform || 'todas-as-redes'}-${periodDays}dias.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function printReport() {
    const rows = reportRows(data, periodDays, selectedPlatform)
    const performanceReport = buildPerformanceReport(data, tiktokVideos, periodDays, selectedPlatform)
    const totals = rows.reduce((total, item) => ({
      views: total.views + Number(item.metrics?.views || 0),
      likes: total.likes + Number(item.metrics?.likes || 0),
      comments: total.comments + Number(item.metrics?.comments || 0),
      shares: total.shares + Number(item.metrics?.shares || 0),
    }), { views: 0, likes: 0, comments: 0, shares: 0 })
    const target = window.open('', '_blank', 'width=1000,height=800')
    if (!target) { notify('Permita pop-ups para gerar o relatório imprimível.', 'error'); return }
    const title = `Relatório ${selectedPlatform ? PLAT_LABELS[selectedPlatform] || selectedPlatform : 'todas as redes'}`
    const tableRows = rows.map(item => `<tr><td>${htmlValue(item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('pt-BR') : '')}</td><td>${htmlValue(PLAT_LABELS[item.platform] || item.platform)}</td><td>${htmlValue(item.text || item.youtubeTitle || 'Publicação')}</td><td>${item.metrics?.views ?? '—'}</td><td>${item.metrics?.likes ?? '—'}</td><td>${item.metrics?.comments ?? '—'}</td><td>${item.metrics?.shares ?? '—'}</td></tr>`).join('')
    const reportRowsHtml = performanceReport.platforms.map(item => `<tr><td>${htmlValue(PLAT_LABELS[item.platform] || item.platform)}</td><td>${item.content}</td><td>${item.views == null ? '—' : fmtNum(Math.round(item.views))}</td><td>${item.interactions == null ? '—' : fmtNum(Math.round(item.interactions))}</td><td>${item.rate == null ? '—' : `${item.rate.toFixed(1)}%`}</td></tr>`).join('')
    const bestContentRowsHtml = performanceReport.platforms.map(item => {
      const best = item.bestContent
      const metricNumber = value => {
        const normalized = value && typeof value === 'object' ? value.total : value
        const number = Number(normalized)
        return Number.isFinite(number) ? number : null
      }
      const interactions = best ? ['likes', 'comments', 'shares', 'saves'].reduce((sum, name) => sum + (metricNumber(best.metrics?.[name]) || 0), 0) : null
      const views = best ? metricNumber(best.metrics?.views) : null
      const title = best?.text || best?.title || best?.youtubeTitle || best?.caption || 'Nenhum post com métricas confirmadas no período.'
      return `<tr><td>${htmlValue(PLAT_LABELS[item.platform] || item.platform)}</td><td>${htmlValue(title)}</td><td>${views == null ? '—' : fmtNum(Math.round(views))}</td><td>${interactions == null ? '—' : fmtNum(Math.round(interactions))}</td></tr>`
    }).join('')
    const actionRows = performanceReportActions(performanceReport).map(action => `<li>${htmlValue(action)}</li>`).join('')
    const explainedReport = `<section class="interpretation"><h2>Desempenho explicado</h2><p>${htmlValue(performanceReportConclusion(performanceReport))}</p><div class="explanation-grid"><div><strong>Visualizações</strong><span>${performanceReport.totals.views == null ? '—' : fmtNum(Math.round(performanceReport.totals.views))}</span><small>Quantidade de vezes que o conteúdo foi visto; não representa necessariamente pessoas únicas.</small></div><div><strong>Interações</strong><span>${performanceReport.totals.interactions == null ? '—' : fmtNum(Math.round(performanceReport.totals.interactions))}</span><small>Curtidas, comentários, compartilhamentos e salvamentos disponíveis.</small></div><div><strong>Taxa de interação</strong><span>${performanceReport.totals.rate == null ? '—' : `${performanceReport.totals.rate.toFixed(1)}%`}</span><small>Interações divididas pelas visualizações, para medir a reação proporcional.</small></div><div><strong>Crescimento da audiência</strong><span>${performanceReport.totals.growth == null ? '—' : fmtNum(Math.round(performanceReport.totals.growth))}</span><small>Variação de seguidores ou inscritos no período.</small></div></div><h3>Leitura por rede</h3><table><thead><tr><th>Rede</th><th>Conteúdos</th><th>Visualizações</th><th>Interações</th><th>Taxa</th></tr></thead><tbody>${reportRowsHtml || '<tr><td colspan="5">Nenhum dado disponível.</td></tr>'}</tbody></table><h3>Melhor conteúdo por rede</h3><table><thead><tr><th>Rede</th><th>Conteúdo</th><th>Visualizações</th><th>Interações</th></tr></thead><tbody>${bestContentRowsHtml || '<tr><td colspan="4">Nenhum dado disponível.</td></tr>'}</tbody></table><h3>Próximos passos recomendados</h3><ol>${actionRows}</ol></section>`
    target.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${htmlValue(title)}</title><style>body{font-family:Arial,sans-serif;color:#20242c;margin:36px}h1{margin:0 0 6px;font-size:24px}h2{margin:0 0 8px;font-size:18px}h3{margin:20px 0 8px;font-size:13px}p{color:#616875;margin:0 0 22px;line-height:1.5}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}.card,.explanation-grid>div{padding:12px;background:#f2f4f7;border-radius:8px}.card strong,.explanation-grid span{display:block;font-size:20px}.card span,.explanation-grid small{font-size:11px;color:#616875}.interpretation{margin:0 0 28px;padding:18px;border:1px solid #dfe3e8;border-radius:10px}.interpretation>p{margin-bottom:14px}.explanation-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.explanation-grid strong{display:block;font-size:11px;margin-bottom:5px}.explanation-grid small{display:block;margin-top:5px;line-height:1.4}.interpretation table,table{width:100%;border-collapse:collapse;font-size:11px}.interpretation th,.interpretation td,body>table th,body>table td{padding:8px;border-bottom:1px solid #dfe3e8;text-align:left}.interpretation th,th{background:#f2f4f7}.interpretation ol{margin:0;padding-left:20px;color:#616875;font-size:11px;line-height:1.6}@media print{body{margin:18px}.card,.explanation-grid>div,th{background:#f2f4f7}.interpretation{break-inside:avoid}}</style></head><body><h1>${htmlValue(title)}</h1><p>Período: últimos ${periodDays} dias · Gerado em ${htmlValue(new Date().toLocaleString('pt-BR'))}</p>${explainedReport}<h2>Publicações detalhadas</h2><table><thead><tr><th>Data</th><th>Rede</th><th>Publicação</th><th>Visualizações</th><th>Curtidas</th><th>Comentários</th><th>Compartilhamentos</th></tr></thead><tbody>${tableRows || '<tr><td colspan="7">Nenhum dado encontrado no período.</td></tr>'}</tbody></table></body></html>`)
    target.document.close()
    target.focus()
    setTimeout(() => { target.print() }, 250)
  }

  return <section className="page-view analytics-page">
    <header className="analytics-page-intro">
      <p className="eyebrow">DESEMPENHO</p>
      <h2>Entenda o desempenho das suas redes</h2>
      <p>Veja o que chamou atenção, quais publicações performaram melhor e como sua audiência está evoluindo.</p>
      <div className="analytics-page-intro-actions"><div className="analytics-export-actions"><button type="button" className="secondary-button" onClick={exportReport} disabled={loading || !networks.length}>Exportar CSV</button><button type="button" className="secondary-button" onClick={printReport} disabled={loading || !networks.length}>Imprimir / PDF</button></div><span className="analytics-export-context">Dados do período e da rede selecionados · suas escolhas ficam salvas neste dispositivo</span></div>
    </header>

    <div className="analytics-network-selector-top">
      <AnalyticsSidebar networks={networks} activeNet={activeNet} onSelect={net => { setReportAccountId(null); selectNetwork(net) }}/>
    </div>

    <section className="analytics-report-snapshot" aria-label="Resumo do relatório filtrado">
      <div><span>Conteúdos no recorte</span><strong>{loading ? '—' : selectedRows.length}</strong></div>
      <div><span>Visualizações</span><strong>{loading ? '—' : fmtNum(selectedViews)}</strong></div>
      <div><span>Interações</span><strong>{loading ? '—' : fmtNum(selectedEngagement)}</strong></div>
      <div><span>Rede analisada</span><strong>{loading ? '—' : selectedPlatform ? PLAT_LABELS[selectedPlatform] || selectedPlatform : 'Todas'}</strong></div>
    </section>
    <ReportSchedulePanel />

    {error && <p className="error-message" role="alert">{error}</p>}
    {loading && !error && <p className="empty-state" aria-live="polite">Carregando métricas...</p>}
    {!loading && accounts.length > 0 && <AnalyticsAccountProfiles accounts={accounts} data={data} tiktokVideos={tiktokVideos} periodDays={periodDays} activeNet={selectedPlatform} onSelectNetwork={openAccountReport}/>}
    {!loading && <AnalyticsExecutiveOverview data={data} tiktokVideos={tiktokVideos} periodDays={periodDays} activeNet={selectedPlatform} recommendedActions={performanceReportActions(performanceReport)}/>}
    {!loading && networks.length > 0 && <AnalyticsSummary
      data={data}
      tiktokVideos={tiktokVideos}
      periodDays={periodDays}
      activeNet={selectedPlatform}
      onSelectPeriod={days => { setPeriodDays(days); if (days > 30) setComparePeriod(false) }}
      comparePeriod={comparePeriod}
      onToggleCompare={setComparePeriod}
    />}
    {!loading && !networks.length && <section className="analytics-empty-state" aria-labelledby="analytics-empty-title">
      <span className="analytics-empty-icon" aria-hidden="true">📊</span>
      <h3 id="analytics-empty-title">Ainda não há métricas para mostrar</h3>
      <p>Conecte uma rede social e publique conteúdo para começar a acompanhar visualizações, interações e crescimento.</p>
      <p className="analytics-empty-note">As plataformas aparecem ao lado mesmo antes da primeira conexão.</p>
    </section>}

    <div className="analytics-layout">
      {loading
        ? <section className="analytics-no-network-panel"><span className="analytics-empty-icon" aria-hidden="true">…</span><h3>Carregando redes</h3><p>Verificando conexões e métricas disponíveis.</p></section>
        : activeNet === 'all'
          ? networks.length
            ? <div className="analytics-all-network-panels">{networks.map(net => <AnalyticsPanel
                key={net}
                net={net}
                tab="community"
                onSelectTab={setActiveTab}
                data={data}
                tiktokVideos={tiktokVideos}
                periodDays={periodDays}
                lastUpdated={lastUpdated}
                reportAccountId={null}
              />)}</div>
            : <section className="analytics-no-network-panel" aria-labelledby="analytics-no-network-title">
                <span className="analytics-empty-icon" aria-hidden="true">◎</span>
                <h3 id="analytics-no-network-title">Nenhuma rede conectada</h3>
                <p>Conecte uma conta para liberar os relatórios das redes.</p>
              </section>
          : networks.includes(activeNet)
          ? <AnalyticsPanel
              net={activeNet}
              tab={activeTab}
              onSelectTab={setActiveTab}
              data={data}
              tiktokVideos={tiktokVideos}
              periodDays={periodDays}
              lastUpdated={lastUpdated}
              reportAccountId={reportAccountId}
            />
          : <section className="analytics-no-network-panel" aria-labelledby="analytics-no-network-title">
              <span className="analytics-empty-icon" aria-hidden="true">◎</span>
              <h3 id="analytics-no-network-title">Nenhuma rede conectada</h3>
              <p>As logos acima mostram as plataformas disponíveis. Conecte uma conta para liberar os relatórios desta rede.</p>
            </section>}
    </div>
  </section>
}
