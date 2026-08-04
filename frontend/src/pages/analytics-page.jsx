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

  return <section className="page-view">
    <p className="eyebrow">DESEMPENHO</p><h2>Analytics</h2>

    {error && <p className="error-message" role="alert">{error}</p>}
    {loading && !error
      ? <p className="empty-state" aria-live="polite">Carregando métricas...</p>
      : <>
          <AnalyticsSummary data={data} tiktokVideos={tiktokVideos} periodDays={periodDays}/>

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
                onSelectPeriod={setPeriodDays}
                lastUpdated={lastUpdated}
              />
            )}
          </div>
        </>}
  </section>
}
