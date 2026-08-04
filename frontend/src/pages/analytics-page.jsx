import { useCallback } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'

export function AnalyticsPage() {
  const load = useCallback(() => apiFetch('/api/posts/analytics'), [])
  const { value: data, loading, error } = useApiResource(load, null)
  const values = Object.entries(data || {}).filter(([, value]) => typeof value === 'number')

  return <section className="page-view"><section className="panel">
    <p className="eyebrow">DESEMPENHO</p><h2>Analytics</h2>
    {error ? <p className="error-message" role="alert">{error}</p> : loading ? <p className="empty-state" aria-live="polite">Carregando métricas...</p> : <div className="metric-grid">{values.length ? values.map(([key, value]) => <article key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{value}</strong></article>) : <p className="empty-state">Ainda não há métricas disponíveis.</p>}</div>}
  </section></section>
}
