import { Bar, Line } from 'react-chartjs-2'
import { baseChartOptions, fmtNum, formatDiaBR, labelForMetric } from '../../lib/analytics-format.js'

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function collectMetrics(accounts) {
  const values = new Map()
  for (const account of accounts) {
    const maps = [account.totals?.metrics, account.metrics]
    for (const report of Object.values(account.reports || {})) maps.push(report.metrics)
    for (const map of maps) {
      for (const [name, metric] of Object.entries(map || {})) {
        const total = numberValue(metric?.total ?? metric)
        if (total === null) continue
        values.set(name, (values.get(name) || 0) + total)
      }
    }
  }
  return [...values.entries()].sort(([, a], [, b]) => b - a)
}

function collectSeries(accounts) {
  const byDate = new Map()
  for (const account of accounts) {
    const maps = [account.timeSeries?.metrics]
    if (account.metrics) maps.push(account.metrics)
    for (const map of maps) {
      for (const [name, metric] of Object.entries(map || {})) {
        for (const item of metric?.values || []) {
          if (!item.date || numberValue(item.value) === null) continue
          const day = byDate.get(item.date) || {}
          day[name] = (day[name] || 0) + item.value
          byDate.set(item.date, day)
        }
      }
    }
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function collectBreakdowns(accounts) {
  const result = new Map()
  for (const account of accounts) {
    for (const metric of Object.values(account.totals?.metrics || {})) {
      for (const item of metric.breakdowns || []) {
        if (!item.dimension) continue
        result.set(item.dimension, (result.get(item.dimension) || 0) + (item.value || 0))
      }
    }
    for (const report of Object.values(account.reports || {})) {
      for (const row of report.rows || []) {
        const dimension = Object.entries(row).find(([key]) => key !== 'views' && key !== 'estimatedMinutesWatched')
        if (dimension) result.set(`${dimension[0]}: ${dimension[1]}`, (result.get(`${dimension[0]}: ${dimension[1]}`) || 0) + (Number(row.views) || 0))
      }
    }
  }
  return [...result.entries()].sort(([, a], [, b]) => b - a).slice(0, 12)
}

function collectDailyRows(data, net) {
  return (data.accountAnalytics?.dailyMetrics || [])
    .filter(item => item.platform === net)
    .flatMap(item => {
      const source = item.data || {}
      return source.days || source.dailyMetrics || source.values || []
    })
}

function ProviderTimeline({ net, data }) {
  const rows = collectDailyRows(data, net)
  if (!rows.length) return null
  const names = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !['date', 'day'].includes(key) && typeof row[key] === 'number')))].slice(0, 5)
  if (!names.length) return null
  return <div className="analytics-provider-table">
    <div className="analytics-section-title">Métricas diárias agregadas</div>
    <div className="analytics-table-scroll"><table>
      <thead><tr><th>Data</th>{names.map(name => <th key={name}>{labelForMetric(name)}</th>)}</tr></thead>
      <tbody>{rows.slice(-30).map((row, index) => <tr key={`${row.date || row.day || index}-${index}`}>
        <td>{row.date || row.day || '—'}</td>
        {names.map(name => <td key={name}>{fmtNum(row[name])}</td>)}
      </tr>)}</tbody>
    </table></div>
  </div>
}

function ProviderGrowth({ net, data }) {
  const accounts = (data.accountAnalytics?.followerStats?.accounts || []).filter(account => account.platform === net)
  if (!accounts.length) return null
  return <div className="analytics-provider-growth">
    <div className="analytics-section-title">Crescimento de seguidores</div>
    {accounts.map(account => <div className="analytics-provider-growth-row" key={account._id || account.accountId}>
      <span>{account.username || account.accountName || 'Conta'}</span>
      <strong>{fmtNum(account.currentFollowers)}</strong>
      <span className={account.growth >= 0 ? 'growth-positive' : 'growth-negative'}>{account.growth >= 0 ? '+' : ''}{fmtNum(account.growth)} ({Number(account.growthPercentage || 0).toFixed(1)}%)</span>
    </div>)}
  </div>
}

function ProviderDecay({ net, data }) {
  const buckets = (data.accountAnalytics?.contentDecay || [])
    .filter(item => item.platform === net)
    .flatMap(item => item.data?.buckets || item.data?.decay || [])
  if (!buckets.length) return null
  return <div className="analytics-provider-growth">
    <div className="analytics-section-title">Vida útil do conteúdo</div>
    <div className="analytics-decay-list">{buckets.map((bucket, index) => {
      const label = bucket.label || bucket.bucket || bucket.window || `${index + 1}`
      const value = bucket.percentage ?? bucket.percent ?? bucket.engagementPercentage ?? bucket.value
      return <span key={`${label}-${index}`}><strong>{label}</strong> {value == null ? '' : `${Number(value).toFixed(1)}%`}</span>
    })}</div>
  </div>
}

function InsightSeries({ accounts }) {
  const entries = collectSeries(accounts)
  if (!entries.length) return null
  const names = [...new Set(entries.flatMap(([, values]) => Object.keys(values)))].slice(0, 5)
  return <div className="analytics-insight-chart">
    <div className="analytics-section-title">Evolução das métricas da conta</div>
    <Line
      data={{
        labels: entries.map(([date]) => formatDiaBR(date)),
        datasets: names.map((name, index) => ({
          label: labelForMetric(name),
          data: entries.map(([, values]) => values[name] || 0),
          borderColor: ['#d1993e', '#e94f8a', '#4ade80', '#5b8def', '#a78bfa'][index],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 2
        }))
      }}
      options={baseChartOptions()}
    />
  </div>
}

function InsightBreakdowns({ accounts }) {
  const entries = collectBreakdowns(accounts)
  if (!entries.length) return null
  return <div className="analytics-insight-chart">
    <div className="analytics-section-title">Detalhes por dimensão</div>
    <Bar
      data={{
        labels: entries.map(([label]) => label),
        datasets: [{ label: 'Valor', data: entries.map(([, value]) => value), backgroundColor: '#5b8def', borderRadius: 4 }]
      }}
      options={{ ...baseChartOptions(), indexAxis: 'y', plugins: { legend: { display: false } } }}
    />
  </div>
}

export function AnalyticsAccountInsights({ net, data }) {
  const accounts = data.accountAnalytics?.platforms?.[net] || []
  if (!accounts.length) return null

  const metrics = collectMetrics(accounts)
  const unavailable = [...new Set([
    ...(data.accountAnalytics?.capabilities?.[net]?.unavailable || []),
    ...accounts.flatMap(account => account.unavailableMetrics || [])
  ])]
  const errors = accounts.flatMap(account => account.errors || [])

  return <section className="analytics-account-insights">
        <div className="analytics-insights-heading">
      <div>
        <div className="analytics-section-title">Dados detalhados das contas</div>
        <div className="analytics-insights-subtitle">{accounts.length} conta(s) conectada(s), com métricas específicas fornecidas pela API oficial.</div>
      </div>
      <span className="analytics-insights-badge">API oficial</span>
    </div>

    {metrics.length
      ? <div className="analytics-insight-metrics">
          {metrics.map(([name, value]) => <div className="analytics-insight-metric" key={name}>
            <strong>{fmtNum(value)}</strong>
            <span>{labelForMetric(name)}</span>
          </div>)}
        </div>
      : <p className="empty-state">A rede não retornou métricas detalhadas para o período.</p>}

    <InsightSeries accounts={accounts}/>
    <InsightBreakdowns accounts={accounts}/>
    <ProviderGrowth net={net} data={data}/>
    <ProviderTimeline net={net} data={data}/>
    <ProviderDecay net={net} data={data}/>

    {unavailable.length > 0 && <details className="analytics-limitations">
      <summary>Métricas não expostas pela API</summary>
      <p>{unavailable.map(labelForMetric).join(' · ')}</p>
    </details>}
    {errors.length > 0 && <details className="analytics-limitations analytics-limitations-warning">
      <summary>Relatórios indisponíveis nesta conexão ({errors.length})</summary>
      <p>{[...new Set(errors.map(error => error.scope || error.message).filter(Boolean))].join(' · ')}</p>
    </details>}
  </section>
}
