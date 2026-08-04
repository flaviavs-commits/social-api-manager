import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'

export function DashboardPage({ onNavigate }) {
  const [data, setData] = useState({ posts: [], accounts: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([apiFetch('/api/posts'), apiFetch('/api/accounts')])
      .then(([posts, accounts]) => setData({ posts: posts.posts || posts || [], accounts: accounts.accounts || accounts || [] }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const scheduled = data.posts.filter(p => p.status === 'scheduled' || p.status === 'agendado').length

  return <section className="page-view">
    <div className="metric-grid">
      <article><span>Publicações</span><strong>{data.posts.length}</strong></article>
      <article><span>Agendadas</span><strong>{scheduled}</strong></article>
      <article><span>Contas conectadas</span><strong>{data.accounts.length}</strong></article>
    </div>
    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">ATIVIDADE</p><h2>Publicações recentes</h2></div>
        <button className="action-button" onClick={() => onNavigate('agendador')}>Criar publicação</button>
      </div>
      {error
        ? <p className="error-message" role="alert">{error}</p>
        : loading
          ? <p className="empty-state" aria-live="polite">Carregando publicações...</p>
          : data.posts.length
            ? <div className="data-list">{data.posts.slice(0, 8).map(post => <div className="data-row" key={post.id}><span>{post.text || post.title || 'Publicação sem texto'}</span><small>{post.status || '—'}</small></div>)}</div>
            : <p className="empty-state">Nenhuma publicação encontrada.</p>}
    </section>
  </section>
}
