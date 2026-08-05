import '../lib/chart-setup.js'
import { useAnalytics } from '../hooks/use-analytics.js'
import { AnalyticsSummary } from '../components/analytics/analytics-summary.jsx'
import { AnalyticsSidebar } from '../components/analytics/analytics-sidebar.jsx'
import { AnalyticsPanel } from '../components/analytics/analytics-panel.jsx'

export function AnalyticsPage() {
  const {
    data, tiktokVideos, networks, activeNet, activeTab, periodDays,
    loading, error, lastUpdated, setActiveTab, setPeriodDays, selectNetwork,
  } = useAnalytics()

  return <section className="page-view analytics-page">
    <header className="analytics-page-intro">
      <p className="eyebrow">DESEMPENHO</p>
      <h2>Entenda o desempenho das suas redes</h2>
      <p>Veja o que chamou atenção, quais publicações performaram melhor e como sua audiência está evoluindo.</p>
    </header>

    {error && <p className="error-message" role="alert">{error}</p>}
    {loading && !error
      ? <p className="empty-state" aria-live="polite">Carregando métricas...</p>
      : !networks.length && !error
        ? <section className="analytics-empty-state" aria-labelledby="analytics-empty-title">
            <span className="analytics-empty-icon" aria-hidden="true">📊</span>
            <h3 id="analytics-empty-title">Ainda não há métricas para mostrar</h3>
            <p>Conecte uma rede social e publique conteúdo para começar a acompanhar visualizações, interações e crescimento.</p>
            <p className="analytics-empty-note">Quando houver dados, você poderá comparar cada rede e período nesta tela.</p>
          </section>
      : <>
          <AnalyticsSummary
            data={data}
            tiktokVideos={tiktokVideos}
            periodDays={periodDays}
            onSelectPeriod={setPeriodDays}
          />

          <div className="analytics-layout">
            <AnalyticsSidebar networks={networks} activeNet={activeNet} onSelect={selectNetwork}/>
            {networks.includes(activeNet) && (
              <AnalyticsPanel
                net={activeNet}
                tab={activeTab}
                onSelectTab={setActiveTab}
                data={data}
                tiktokVideos={tiktokVideos}
                periodDays={periodDays}
                lastUpdated={lastUpdated}
              />
            )}
          </div>
        </>}
  </section>
}
