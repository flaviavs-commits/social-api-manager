import { Bar, Line } from 'react-chartjs-2'
import { baseChartOptions, fmtNum, formatDiaBR, labelForMetric } from '../../lib/analytics-format.js'
import { useTheme } from '../ui/theme-selector.jsx'

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

function sampleSeries(entries, maxPoints = 30) {
  if (entries.length <= maxPoints) return entries
  const indexes = new Set(Array.from({ length: maxPoints }, (_, index) => Math.round(index * (entries.length - 1) / (maxPoints - 1))))
  return [...indexes].sort((a, b) => a - b).map(index => entries[index])
}

function collectBreakdowns(accounts) {
  const result = new Map()
  for (const account of accounts) {
    for (const [metricName, metric] of Object.entries(account.totals?.metrics || {})) {
      for (const item of metric.breakdowns || []) {
        if (!item.dimension) continue
        const label = `${labelForMetric(metricName)} · ${item.dimension}`
        result.set(label, (result.get(label) || 0) + (item.value || 0))
      }
    }
    for (const report of Object.values(account.reports || {})) {
      for (const row of report.rows || []) {
        const dimension = Object.entries(row).find(([key]) => key !== 'views' && key !== 'estimatedMinutesWatched')
        if (dimension) result.set(`${dimension[0]}: ${dimension[1]}`, (result.get(`${dimension[0]}: ${dimension[1]}`) || 0) + (Number(row.views) || 0))
      }
    }
  }
  return [...result.entries()].sort(([, a], [, b]) => b - a)
}

function belongsToAccount(item, accountId) {
  if (!accountId) return true
  return [item.localAccountId, item.accountId, item.providerAccountId, item._id].some(value => value != null && String(value) === String(accountId))
}

function collectDailyRows(data, net, accountId) {
  return (data.accountAnalytics?.dailyMetrics || [])
    .filter(item => item.platform === net && belongsToAccount(item, accountId))
    .flatMap(item => {
      const source = item.data || {}
      return source.dailyData || source.days || source.dailyMetrics || source.values || []
    })
}

function ProviderTimeline({ net, data, accountId }) {
  const rows = collectDailyRows(data, net, accountId)
  if (!rows.length) return null
  const names = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !['date', 'day'].includes(key) && typeof row[key] === 'number')))]
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

function ProviderGrowth({ net, data, accountId }) {
  const accounts = (data.accountAnalytics?.followerStats?.accounts || []).filter(account => account.platform === net && belongsToAccount(account, accountId))
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

function ProviderDecay({ net, data, accountId }) {
  const buckets = (data.accountAnalytics?.contentDecay || [])
    .filter(item => item.platform === net && belongsToAccount(item, accountId))
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

function ProviderBestTime({ net, data, accountId }) {
  const slots = (data.accountAnalytics?.bestTimeToPost || [])
    .filter(item => item.platform === net && belongsToAccount(item, accountId))
    .flatMap(item => item.data?.slots || [])
    .sort((a, b) => Number(b.avg_engagement || 0) - Number(a.avg_engagement || 0))
    .slice(0, 5)
  if (!slots.length) return null
  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  return <div className="analytics-provider-growth">
    <div className="analytics-section-title">Melhores horários para publicar (UTC)</div>
    <div className="analytics-decay-list">{slots.map((slot, index) => <span key={`${slot.day_of_week}-${slot.hour}-${index}`}>
      <strong>{days[Number(slot.day_of_week)] || `Dia ${slot.day_of_week}`}, {String(slot.hour).padStart(2, '0')}h</strong>{' '}
      {fmtNum(Number(slot.avg_engagement || 0))} interações médias · {slot.post_count || 0} posts
    </span>)}</div>
  </div>
}

function InsightSeries({ accounts }) {
  const entries = collectSeries(accounts)
  if (!entries.length) return null
  const chartEntries = sampleSeries(entries)
  const names = [...new Set(chartEntries.flatMap(([, values]) => Object.keys(values)))].slice(0, 4)
  return <div className="analytics-insight-chart">
    <div className="analytics-insight-chart-heading"><div className="analytics-section-title">Evolução das principais métricas</div><span>{entries.length > chartEntries.length ? `Visão compacta · ${chartEntries.length} pontos` : `${entries.length} pontos`}</span></div>
    <Line
      data={{
        labels: chartEntries.map(([date]) => formatDiaBR(date)),
        datasets: names.map((name, index) => ({
          label: labelForMetric(name),
          data: chartEntries.map(([, values]) => values[name] || 0),
          borderColor: ['#d1993e', '#e94f8a', '#4ade80', '#5b8def', '#a78bfa'][index],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 2
        }))
      }}
      options={{ ...baseChartOptions(), scales: { ...baseChartOptions().scales, x: { ...baseChartOptions().scales.x, ticks: { ...baseChartOptions().scales.x.ticks, maxTicksLimit: 8, maxRotation: 0 } } } }}
    />
  </div>
}

function MetricSeriesTable({ accounts }) {
  const entries = collectSeries(accounts)
  if (!entries.length) return null
  const names = [...new Set(entries.flatMap(([, values]) => Object.keys(values)))]
  return <details className="analytics-report-detail">
    <summary>Ver série diária completa <span>{entries.length} pontos</span></summary>
    <div className="analytics-provider-table analytics-full-series">
      <p className="analytics-insights-subtitle">Todos os pontos de série temporal retornados pela rede.</p>
      <div className="analytics-table-scroll"><table>
        <thead><tr><th>Data</th>{names.map(name => <th key={name}>{labelForMetric(name)}</th>)}</tr></thead>
        <tbody>{entries.slice(-90).map(([date, values]) => <tr key={date}><td>{formatDiaBR(date)}</td>{names.map(name => <td key={name}>{values[name] == null ? '—' : fmtNum(values[name])}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  </details>
}

function demographicRows(value, prefix = '') {
  if (value == null) return []
  if (typeof value === 'number') return [{ label: prefix || 'Valor', value }]
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (item && typeof item === 'object' && item.value != null) {
        const dimension = Array.isArray(item.dimensionValues) ? item.dimensionValues.join(' · ') : item.dimension || item.label || item.name || `${prefix || 'Item'} ${index + 1}`
        return [{ label: prefix ? `${prefix} · ${dimension}` : dimension, value: Number(item.value) }]
      }
      return demographicRows(item, prefix || `Item ${index + 1}`)
    }).filter(item => Number.isFinite(item.value))
  }
  if (typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => demographicRows(child, prefix ? `${prefix} · ${key}` : key))
}

const demographicCategoryDefinitions = [
  { key: 'age', label: 'Idade', icon: '◷' },
  { key: 'gender', label: 'Gênero', icon: '◉' },
  { key: 'city', label: 'Cidades', icon: '⌖' },
  { key: 'country', label: 'Países', icon: '◎' }
]

function normalizeDemographicText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function demographicCategoryFor(groupName, rowLabel) {
  const text = normalizeDemographicText(`${groupName} ${rowLabel}`)
  if (/(^|[\s·:_-])(age|idade|faixa etaria|age range)(?=$|[\s·:_-])/.test(text)) return 'age'
  if (/(^|[\s·:_-])(gender|genero|sexo|sex)(?=$|[\s·:_-])/.test(text)) return 'gender'
  if (/(^|[\s·:_-])(city|cidade|municipio)(?=$|[\s·:_-])/.test(text)) return 'city'
  if (/(^|[\s·:_-])(country|pais|nation)(?=$|[\s·:_-])/.test(text)) return 'country'
  return null
}

function cleanDemographicLabel(label, category) {
  const categoryWords = {
    age: ['age', 'idade', 'faixa etaria', 'age range'],
    gender: ['gender', 'genero', 'sexo', 'sex'],
    city: ['city', 'cidade', 'municipio'],
    country: ['country', 'pais', 'nation']
  }
  const words = new Set(categoryWords[category] || [])
  const parts = String(label || '').split(' · ').filter(Boolean)
  while (parts.length > 1 && words.has(normalizeDemographicText(parts[0]))) parts.shift()
  return parts.join(' · ') || String(label || 'Valor')
}

function collectDemographicCategories(accounts) {
  const buckets = Object.fromEntries(demographicCategoryDefinitions.map(category => [category.key, new Map()]))
  accounts.forEach(account => {
    Object.entries(account.demographics || {}).forEach(([groupName, value]) => {
      demographicRows(value).forEach(row => {
        const category = demographicCategoryFor(groupName, row.label)
        if (!category) return
        const label = cleanDemographicLabel(row.label, category)
        const current = buckets[category].get(label) || 0
        buckets[category].set(label, current + Number(row.value))
      })
    })
  })
  return demographicCategoryDefinitions.map(category => ({
    ...category,
    rows: [...buckets[category.key].entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 45)
  }))
}

function InsightDemographics({ accounts }) {
  const categories = collectDemographicCategories(accounts)
  if (!categories.some(category => category.rows.length)) return null
  return <div className="analytics-account-demographics">
    <div className="analytics-section-title">Demografia e audiência</div>
    <p className="analytics-insights-subtitle">Dimensões de público devolvidas pela integração da conta, organizadas por categoria.</p>
    <div className="analytics-demographic-category-grid">{categories.map(category => <section className={`analytics-demographic-category is-${category.key}`} key={category.key}>
      <div className="analytics-demographic-category-heading">
        <span className="analytics-demographic-category-icon" aria-hidden="true">{category.icon}</span>
        <div><strong>{category.label}</strong><small>{category.rows.length ? `${category.rows.length} dimensões` : 'Sem dados disponíveis'}</small></div>
      </div>
      {category.rows.length ? <div className="analytics-demographic-category-list">{category.rows.map(row => <span key={row.label}><b title={row.label}>{row.label}</b><em>{fmtNum(row.value)}</em></span>)}</div> : <p className="analytics-demographic-category-empty">A integração não retornou dados de {category.label.toLowerCase()}.</p>}
    </section>)}</div>
  </div>
}

function ReportCoverage({ accounts }) {
  const ranges = accounts.map(account => account.dateRange).filter(range => range?.since || range?.until)
  const delays = accounts.flatMap(account => [account.totals?.dataDelay, account.timeSeries?.dataDelay, account.dataDelay]).filter(Boolean)
  const names = accounts.map(account => account.accountName).filter(Boolean)
  return <div className="analytics-report-coverage">
    <span><b>Fonte</b> API oficial</span>
    {names.length > 0 && <span><b>Perfil</b> {names.join(' · ')}</span>}
    {ranges[0] && <span><b>Janela</b> {ranges[0].since || '—'} até {ranges[0].until || '—'}</span>}
    {delays.length > 0 && <span><b>Atualização</b> {[...new Set(delays)].join(' · ')}</span>}
  </div>
}

function InsightBreakdowns({ accounts }) {
  const entries = collectBreakdowns(accounts)
  if (!entries.length) return null
  return <details className="analytics-report-detail">
    <summary>Ver detalhes por dimensão <span>{entries.length} dimensões</span></summary>
    <div className="analytics-insight-chart analytics-breakdown-chart">
      <div className="analytics-insight-chart-heading"><div className="analytics-section-title">Detalhes por dimensão</div><span>Top 20</span></div>
      <Bar
        data={{
            labels: entries.slice(0, 20).map(([label]) => label),
            datasets: [{ label: 'Valor', data: entries.slice(0, 20).map(([, value]) => value), backgroundColor: '#5b8def', borderRadius: 4 }]
        }}
        options={{ ...baseChartOptions(), indexAxis: 'y', plugins: { legend: { display: false } }, scales: { ...baseChartOptions().scales, x: { ...baseChartOptions().scales.x, ticks: { ...baseChartOptions().scales.x.ticks, maxTicksLimit: 6 } }, y: { ...baseChartOptions().scales.y, ticks: { ...baseChartOptions().scales.y.ticks, autoSkip: false, font: { size: 10 } } } } }}
      />
    </div>
  </details>
}

export function AnalyticsAccountInsights({ net, data, accountId = null }) {
  useTheme()
  const allAccounts = data.accountAnalytics?.platforms?.[net] || []
  const accounts = accountId
    ? allAccounts.filter(account => belongsToAccount(account, accountId))
    : allAccounts
  if (!accounts.length) return null

  const metrics = collectMetrics(accounts)
  const unavailable = [...new Set([
    ...(data.accountAnalytics?.capabilities?.[net]?.unavailable || []),
    ...accounts.flatMap(account => account.unavailableMetrics || [])
  ])]
  const errors = accounts.flatMap(account => account.errors || [])

  const reportName = accounts.length === 1 ? accounts[0].accountName || accounts[0].username || accounts[0].accountId : `${accounts.length} contas`

  return <section id="analytics-account-report" className="analytics-account-insights">
        <div className="analytics-insights-heading">
      <div>
        <div className="analytics-section-title">Relatório completo do perfil</div>
        <div className="analytics-insights-subtitle">{reportName || `${accounts.length} conta(s)`} · métricas específicas fornecidas pela API oficial.</div>
      </div>
      <span className="analytics-insights-badge">{accountId ? 'Perfil selecionado' : 'Todas as contas'}</span>
    </div>

    <ReportCoverage accounts={accounts}/>

    {metrics.length
      ? <div className="analytics-insight-metrics">
          {metrics.map(([name, value]) => <div className="analytics-insight-metric" key={name}>
            <strong>{fmtNum(value)}</strong>
            <span>{labelForMetric(name)}</span>
          </div>)}
        </div>
      : <p className="empty-state">A rede não retornou métricas detalhadas para o período.</p>}

    <InsightSeries accounts={accounts}/>
    <MetricSeriesTable accounts={accounts}/>
    <InsightBreakdowns accounts={accounts}/>
    <InsightDemographics accounts={accounts}/>
    <ProviderGrowth net={net} data={data} accountId={accountId}/>
    <ProviderTimeline net={net} data={data} accountId={accountId}/>
    <ProviderDecay net={net} data={data} accountId={accountId}/>
    <ProviderBestTime net={net} data={data} accountId={accountId}/>

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
