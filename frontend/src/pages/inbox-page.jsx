import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { CommentsModal } from '../components/analytics/comments-modal.jsx'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { useToast } from '../components/ui/toast.jsx'

const INBOX_FILTERS_KEY = 'meu-ecoo:inbox-filters'
const inboxPlatforms = [
  { id: 'all', label: 'Todas as redes' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
]

function readInboxFilters() {
  try { return JSON.parse(localStorage.getItem(INBOX_FILTERS_KEY) || '{}') } catch { return {} }
}

export function InboxPage() {
  const [platform, setPlatform] = useState(() => readInboxFilters().platform || 'all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(() => readInboxFilters().status || 'all')
  const [unread, setUnread] = useState({})
  const [selectedPostIds, setSelectedPostIds] = useState([])
  const [selectedPostId, setSelectedPostId] = useState(null)
  const notify = useToast()
  const load = useCallback(() => apiFetch(`/api/posts/inbox${platform === 'all' ? '' : `?platform=${platform}`}`).then(data => data.posts || []), [platform])
  const { value: posts, loading, error } = useApiResource(load, [])
  const loadUnread = useCallback(() => apiFetch('/api/posts/inbox/unread').then(data => setUnread(data.unread || {})).catch(() => {}), [])
  const handleConversationClose = useCallback(() => { loadUnread() }, [loadUnread])

  useEffect(() => { loadUnread() }, [loadUnread])
  useEffect(() => { localStorage.setItem(INBOX_FILTERS_KEY, JSON.stringify({ platform, status: statusFilter })) }, [platform, statusFilter])

  const visiblePosts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return posts.filter(post => {
      const matchesSearch = !query || (post.text || post.title || '').toLowerCase().includes(query)
      const hasUnread = Number(unread[post.id] || 0) > 0
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'unread' ? hasUnread : !hasUnread)
      return matchesSearch && matchesStatus
    })
  }, [posts, search, statusFilter, unread])
  const totalUnread = Object.values(unread).reduce((sum, value) => sum + Number(value || 0), 0)

  useEffect(() => {
    if (!visiblePosts.length) { setSelectedPostId(null); return }
    if (!visiblePosts.some(post => post.id === selectedPostId)) setSelectedPostId(visiblePosts[0].id)
  }, [visiblePosts, selectedPostId])

  function toggleSelected(id) {
    setSelectedPostIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function toggleAllVisible(event) {
    setSelectedPostIds(event.target.checked ? visiblePosts.map(post => post.id) : [])
  }

  async function markAsRead(ids = selectedPostIds) {
    if (!ids.length) return
    try {
      await apiFetch('/api/posts/inbox/seen', { method: 'POST', body: JSON.stringify({ postIds: ids }) })
      setSelectedPostIds([])
      await loadUnread()
      notify(`${ids.length} ${ids.length === 1 ? 'publicação marcada' : 'publicações marcadas'} como lida${ids.length === 1 ? '' : 's'}.`)
    } catch (caught) {
      notify(caught.message, 'error')
    }
  }

  return <section className="page-view inbox-page"><section className="panel inbox-panel">
    <div className="inbox-heading"><div><p className="eyebrow">INTERAÇÕES</p><h2>Inbox</h2><p>Organize comentários e responda sua comunidade sem sair do painel.</p></div>{totalUnread > 0 && <span className="inbox-unread-total">{totalUnread} não lido{totalUnread > 1 ? 's' : ''}</span>}</div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="inbox-platform-filter" role="group" aria-label="Escolher rede social"><span className="inbox-platform-filter-label">Ver interações de</span>{inboxPlatforms.map(item => <button type="button" className={`inbox-platform-filter-card${platform === item.id ? ' is-active' : ''} inbox-platform-filter-${item.id}`} key={item.id} onClick={() => setPlatform(item.id)} aria-pressed={platform === item.id}>{item.id === 'all' ? <span className="inbox-platform-filter-icon" aria-hidden="true">◎</span> : <span className="inbox-platform-filter-icon" aria-hidden="true"><PlatformIcon platform={item.id} className="h-6 w-6"/></span>}<span><strong>{item.label}</strong><small>{platform === item.id ? 'Selecionada' : 'Selecionar'}</small></span></button>)}</div>
    <div className="inbox-toolbar"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar publicação..." aria-label="Buscar publicação no Inbox"/><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filtrar status de leitura"><option value="all">Todos os status</option><option value="unread">Não lidos</option><option value="read">Já lidos</option></select></div>
    {visiblePosts.length > 0 && <div className="inbox-bulk-toolbar"><label><input type="checkbox" checked={visiblePosts.length > 0 && visiblePosts.every(post => selectedPostIds.includes(post.id))} onChange={toggleAllVisible}/> Selecionar visíveis</label>{selectedPostIds.length > 0 && <><span>{selectedPostIds.length} selecionada{selectedPostIds.length > 1 ? 's' : ''}</span><button type="button" className="link-button" onClick={() => markAsRead()}>Marcar como lidas</button></>}</div>}
    {loading ? <LoadingState>Carregando interações...</LoadingState> : visiblePosts.length ? <div className="inbox-workspace"><div className="inbox-list-pane"><div className="inbox-list">{visiblePosts.map(post => {
      const count = Number(unread[post.id] || 0)
      const network = post.externalPlatform || post.platform
      return <article className={`inbox-item${count ? ' has-unread' : ''}${selectedPostIds.includes(post.id) ? ' is-selected' : ''}${selectedPostId === post.id ? ' is-active' : ''}`} key={post.id}>
        <input className="inbox-item-checkbox" type="checkbox" checked={selectedPostIds.includes(post.id)} onChange={() => toggleSelected(post.id)} aria-label={`Selecionar ${post.text || post.title || 'publicação'}`}/>
        <span className={`inbox-platform inbox-platform-${network}`} aria-hidden="true"><PlatformIcon platform={network} className="h-4 w-4" /></span>
        <div className="inbox-item-body"><strong>{post.text || post.title || 'Publicação'}</strong><small>{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('pt-BR') : 'Publicação recente'} · {post.commentCount || 0} comentários</small></div>
        <div className="inbox-item-actions">{count > 0 && <span className="inbox-unread-badge">{count} novo{count > 1 ? 's' : ''}</span>}{count > 0 && <button type="button" className="link-button" onClick={() => markAsRead([post.id])}>Marcar lida</button>}<button type="button" className="action-button" onClick={() => setSelectedPostId(post.id)}>Abrir conversa</button></div>
      </article>
    })}</div></div><div className="inbox-conversation-pane">{selectedPostId != null ? <CommentsModal embedded postId={selectedPostId} onClose={handleConversationClose}/> : <div className="inbox-conversation-empty"><span aria-hidden="true">💬</span><strong>Selecione uma publicação</strong><p>Os comentários e as respostas aparecerão aqui.</p></div>}</div></div> : <div className="inbox-empty"><span aria-hidden="true">◎</span><p>{search ? 'Nenhuma publicação corresponde à busca.' : 'Nenhuma interação encontrada.'}</p>{(search || statusFilter !== 'all' || platform !== 'all') && <button className="link-button" onClick={() => { setSearch(''); setPlatform('all'); setStatusFilter('all') }}>Limpar filtros</button>}</div>}
  </section></section>
}
