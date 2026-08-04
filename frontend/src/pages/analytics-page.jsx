import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'

export function AnalyticsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { apiFetch('/api/posts/analytics').then(setData).catch(e => setError(e.message)) }, [])
  const values = Object.entries(data || {}).filter(([, value]) => typeof value === 'number')

  return <section className="page-view"><section className="panel">
    <p className="eyebrow">DESEMPENHO</p><h2>Analytics</h2>
    {error ? <p className="error-message" role="alert">{error}</p> : data ? <div className="metric-grid">{values.length ? values.map(([key, value]) => <article key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{value}</strong></article>) : <p className="empty-state">Ainda não há métricas disponíveis.</p>}</div> : <p className="empty-state" aria-live="polite">Carregando métricas...</p>}
  </section></section>
}
