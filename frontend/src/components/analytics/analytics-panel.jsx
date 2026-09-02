import { NET_TABS, PLAT_LABELS, TAB_HELP } from '../../lib/analytics-format.js'
import { PlatformIcon } from '../ui/platform-icon.jsx'
import { AnalyticsCards } from './analytics-cards.jsx'
import { AnalyticsChart } from './analytics-chart.jsx'
import { AnalyticsDemographics } from './analytics-demographics.jsx'
import { AnalyticsPostsList } from './analytics-posts-list.jsx'
import { AnalyticsAccountInsights } from './analytics-account-insights.jsx'

export function AnalyticsPanel({ net, tab, onSelectTab, data, tiktokVideos, periodDays, lastUpdated, reportAccountId = null }) {
  const tabs = NET_TABS[net] || []
  const selectedTab = tabs.some(item => item.key === tab) ? tab : tabs[0]?.key || 'community'
  const tabDescription = TAB_HELP[selectedTab] || ''
  const listTab = selectedTab === 'posts' || selectedTab === 'videos'
  const chartTitle = selectedTab === 'growth' ? 'Evolução da audiência' : selectedTab === 'community' ? 'Interações no período' : 'Desempenho por publicação'
  const chartDescription = selectedTab === 'growth'
    ? 'Observe se sua base de seguidores ou inscritos está crescendo.'
      : selectedTab === 'community'
      ? 'Veja como a audiência reagiu ao conteúdo publicado.'
      : 'Compare os resultados de cada conteúdo para encontrar os melhores formatos.'

  return (
    <div className="analytics-panel">
      <div className="analytics-panel-heading">
        <div className="analytics-network-heading">
          <span className={`analytics-network-icon analytics-network-icon-${net}`} aria-hidden="true">
            <PlatformIcon platform={net} className="h-5 w-5" />
          </span>
          <div>
            <h3>{PLAT_LABELS[net]}</h3>
            <p>{tabDescription}</p>
          </div>
        </div>
        {lastUpdated && <div className="analytics-last-updated">Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>}
      </div>

      <div className="analytics-tabs" role="tablist" aria-label={`Visões de analytics do ${PLAT_LABELS[net]}`}>
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === selectedTab}
            className={`analytics-tab${t.key === selectedTab ? ' active' : ''}`}
            onClick={() => onSelectTab(t.key)}
          >{t.label}</button>
        ))}
      </div>

      <AnalyticsCards net={net} tab={selectedTab} data={data} tiktokVideos={tiktokVideos} periodDays={periodDays}/>

      <section className="analytics-chart-section analytics-content-section" aria-labelledby="analytics-network-chart-title">
        <div className="analytics-section-heading">
          <div>
            <h3 id="analytics-network-chart-title">{chartTitle}</h3>
            <p>{chartDescription}</p>
          </div>
          <span className="analytics-period-context">Últimos {periodDays} dias</span>
        </div>
        <AnalyticsChart net={net} tab={selectedTab} data={data} tiktokVideos={tiktokVideos} periodDays={periodDays}/>
      </section>

      <AnalyticsDemographics net={net} tab={selectedTab} data={data}/>

      {reportAccountId != null && <AnalyticsAccountInsights net={net} data={data} accountId={reportAccountId}/>}

      {listTab && <section className="analytics-posts-section analytics-content-section" aria-labelledby="analytics-content-list-title">
        <div className="analytics-section-heading">
          <div>
            <h3 id="analytics-content-list-title">Conteúdos publicados</h3>
            <p>Use esta lista para identificar quais conteúdos merecem ser repetidos ou melhorados.</p>
          </div>
        </div>
        <AnalyticsPostsList net={net} tab={selectedTab} data={data} tiktokVideos={tiktokVideos} periodDays={periodDays}/>
      </section>}
    </div>
  )
}
