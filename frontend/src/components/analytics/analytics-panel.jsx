import { NET_TABS } from '../../lib/analytics-format.js'
import { AnalyticsCards } from './analytics-cards.jsx'
import { AnalyticsChart } from './analytics-chart.jsx'
import { AnalyticsDemographics } from './analytics-demographics.jsx'
import { AnalyticsPostsList } from './analytics-posts-list.jsx'

const PERIODS = [7, 30, 90]

export function AnalyticsPanel({ net, tab, onSelectTab, data, tiktokVideos, periodDays, onSelectPeriod, lastUpdated }) {
  const tabs = NET_TABS[net] || []

  return (
    <div className="analytics-panel">
      <div className="analytics-panel-heading">
        <div className="analytics-period-btns">
          {PERIODS.map(days => (
            <button key={days} type="button" className={`analytics-period-btn${days === periodDays ? ' active' : ''}`} onClick={() => onSelectPeriod(days)}>{days}d</button>
          ))}
        </div>
        {lastUpdated && <div className="analytics-last-updated">Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>}
      </div>

      <div className="analytics-tabs">
        {tabs.map(t => (
          <button key={t.key} type="button" className={`analytics-tab${t.key === tab ? ' active' : ''}`} onClick={() => onSelectTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <AnalyticsCards net={net} tab={tab} data={data} tiktokVideos={tiktokVideos} periodDays={periodDays}/>

      <div className="analytics-chart-section">
        <AnalyticsChart net={net} tab={tab} data={data} periodDays={periodDays}/>
      </div>

      <AnalyticsDemographics net={net} tab={tab} data={data}/>

      <div className="analytics-posts-section">
        <AnalyticsPostsList net={net} tab={tab} data={data} tiktokVideos={tiktokVideos} periodDays={periodDays}/>
      </div>
    </div>
  )
}
