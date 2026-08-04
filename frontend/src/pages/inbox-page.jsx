import { useCallback } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'

export function InboxPage() {
  const load = useCallback(() => apiFetch('/api/posts/inbox').then(data => data.posts || []), [])
  const { value: posts, loading, error } = useApiResource(load, [])

  return <section className="page-view"><section className="panel">
    <p className="eyebrow">INTERAÇÕES</p><h2>Inbox</h2>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading ? <p className="empty-state" aria-live="polite">Carregando interações...</p> : posts.length ? posts.map(post => <div className="data-row" key={post.id}><span>{post.text || post.title || 'Publicação'}</span><small>{post.comments_count || post.commentCount || 0} comentários</small></div>) : <p className="empty-state">Nenhuma interação encontrada.</p>}
  </section></section>
}
