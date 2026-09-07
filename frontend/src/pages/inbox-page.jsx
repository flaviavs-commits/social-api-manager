import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { CommentsModal } from '../components/analytics/comments-modal.jsx'
import { LoadingState } from '../components/ui/loading-state.jsx'

const INBOX_FILTERS_KEY = 'meu-ecoo:inbox-filters'
const INBOX_REFRESH_INTERVAL_MS = 60_000
const inboxPlatforms = [
  { id: 'all', label: 'Todas as redes' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
]

function readInboxFilters() {
  try { return JSON.parse(localStorage.getItem(INBOX_FILTERS_KEY) || '{}') } catch { return {} }
}

function readInboxStatusFilter() {
  const status = readInboxFilters().status || 'all'
  return status === 'unread' ? 'unanswered' : status === 'read' ? 'answered' : status
}

function mediaItemsOf(post) {
  return post.mediaItems?.length
    ? post.mediaItems
    : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
}

function firstMediaOf(post) {
  const item = mediaItemsOf(post)[0]
  if (!item) return null
  return {
    source: item.url || item.mediaUrl || item.media_url || item.path,
    type: item.type || item.mediaType || item.media_type,
    thumbnail: item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.poster || item.posterUrl || item.preview || item.previewUrl || item.preview_url || item.cover || item.coverUrl || item.image || item.imageUrl
  }
}

export function InboxMediaPreview({ media }) {
  const isVideo = String(media?.type || '').toLowerCase().includes('video')
  const candidates = [media?.thumbnail, !isVideo ? media?.source : null].filter(Boolean)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const previewSource = candidates[candidateIndex]

  if (!previewSource) return <span>{media ? '▶' : '◎'}</span>
  return <img src={previewSource} alt="Prévia da publicação" onError={() => setCandidateIndex(index => index + 1)} />
}

export function InboxPage() {
  const [platform, setPlatform] = useState(() => readInboxFilters().platform || 'all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(readInboxStatusFilter)
  const [unanswered, setUnanswered] = useState({})
  const [selectedPostId, setSelectedPostId] = useState(null)
  const load = useCallback(() => apiFetch(`/api/posts/inbox${platform === 'all' ? '' : `?platform=${platform}`}`).then(data => data.posts || []), [platform])
  const { value: posts, loading, error, setValue: setPosts, setError } = useApiResource(load, [])
  const loadUnanswered = useCallback(() => apiFetch('/api/posts/inbox/unread').then(data => setUnanswered(data.unanswered || data.unread || {})).catch(() => {}), [])
  const handleConversationClose = useCallback(() => { loadUnanswered() }, [loadUnanswered])
  const handleReplySent = useCallback(() => {
    if (selectedPostId == null) return
    setUnanswered(current => {
      const count = Number(current[selectedPostId] || 0)
      if (count <= 1) {
        const next = { ...current }
        delete next[selectedPostId]
        return next
      }
      return { ...current, [selectedPostId]: count - 1 }
    })
  }, [selectedPostId])

  useEffect(() => {
    let active = true
    let refreshing = false

    const refresh = async () => {
      if (!active || refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try {
        const [nextPosts] = await Promise.all([load(), loadUnanswered()])
        if (active) {
          setPosts(nextPosts)
          setError('')
        }
      } catch (caught) {
        if (active) setError(caught.message)
      } finally {
        refreshing = false
      }
    }

    loadUnanswered()
    const timer = window.setInterval(refresh, INBOX_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [load, loadUnanswered, setError, setPosts])
  useEffect(() => { localStorage.setItem(INBOX_FILTERS_KEY, JSON.stringify({ platform, status: statusFilter })) }, [platform, statusFilter])

  const visiblePosts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return posts.filter(post => {
      const searchable = [post.text, post.content, post.title, post.handle, post.youtubeTitle].filter(Boolean).join(' ').toLowerCase()
      const matchesSearch = !query || searchable.includes(query)
      const hasUnanswered = Number(unanswered[post.id] || 0) > 0
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'unanswered' ? hasUnanswered : !hasUnanswered)
      return matchesSearch && matchesStatus
    })
  }, [posts, search, statusFilter, unanswered])
  const totalUnanswered = Object.values(unanswered).reduce((sum, value) => sum + Number(value || 0), 0)
  const monitoredPlatforms = new Set(visiblePosts.map(post => post.externalPlatform || post.platform).filter(Boolean)).size
  const selectedPost = visiblePosts.find(post => post.id === selectedPostId) || null

  useEffect(() => {
    if (!visiblePosts.length) { setSelectedPostId(null); return }
    if (!visiblePosts.some(post => post.id === selectedPostId)) setSelectedPostId(visiblePosts[0].id)
  }, [visiblePosts, selectedPostId])

  return <section className="page-view inbox-page"><section className="panel inbox-panel">
    <div className="inbox-heading"><div><p className="eyebrow">CENTRAL DE INTERAÇÕES</p><h2>Inbox</h2><p>Veja o que foi publicado, acompanhe os comentários e responda sua comunidade em um só lugar.</p></div><div className="inbox-heading-meta"><span className="inbox-live-status"><i aria-hidden="true" />Monitoramento ativo</span>{totalUnanswered > 0 && <span className="inbox-unanswered-total">{totalUnanswered} comentário{totalUnanswered > 1 ? 's' : ''} não respondido{totalUnanswered > 1 ? 's' : ''}</span>}</div></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="inbox-overview"><div><span>Publicações com interações</span><strong>{visiblePosts.length}</strong><small>no filtro atual</small></div><div><span>Comentários não respondidos</span><strong className={totalUnanswered ? 'is-alert' : ''}>{totalUnanswered}</strong><small>{totalUnanswered ? 'aguardam sua resposta' : 'tudo respondido'}</small></div><div><span>Redes monitoradas</span><strong>{monitoredPlatforms}</strong><small>com atividade recente</small></div></div>
    <div className="inbox-platform-filter" role="group" aria-label="Escolher rede social"><span className="inbox-platform-filter-label">Ver interações de</span>{inboxPlatforms.map(item => <button type="button" className={`inbox-platform-filter-card${platform === item.id ? ' is-active' : ''} inbox-platform-filter-${item.id}`} key={item.id} onClick={() => setPlatform(item.id)} aria-pressed={platform === item.id}>{item.id === 'all' ? <span className="inbox-platform-filter-icon" aria-hidden="true">◎</span> : <span className="inbox-platform-filter-icon" aria-hidden="true"><PlatformIcon platform={item.id} className="h-6 w-6"/></span>}<span><strong>{item.label}</strong><small>{platform === item.id ? 'Selecionada' : 'Selecionar'}</small></span></button>)}</div>
    <div className="inbox-toolbar"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar publicação..." aria-label="Buscar publicação no Inbox"/><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filtrar status de resposta"><option value="all">Todos os status</option><option value="unanswered">Não respondidos</option><option value="answered">Respondidos</option></select></div>
    {loading ? <LoadingState>Carregando interações...</LoadingState> : visiblePosts.length ? <div className="inbox-workspace"><div className="inbox-list-pane"><div className="inbox-list">{visiblePosts.map(post => {
      const count = Number(unanswered[post.id] || 0)
      const network = post.externalPlatform || post.platform
      const media = firstMediaOf(post)
      return <article className={`inbox-item${count ? ' has-unanswered' : ''}${selectedPostId === post.id ? ' is-active' : ''}`} key={post.id}>
        <span className={`inbox-item-media${media?.type === 'video' || media?.type === 'VIDEO' ? ' is-video' : ''}`} aria-hidden="true"><InboxMediaPreview media={media} /></span>
        <span className={`inbox-platform inbox-platform-${network}`} aria-hidden="true"><PlatformIcon platform={network} className="h-4 w-4" /></span>
        <div className="inbox-item-body"><strong>{post.text || post.title || 'Publicação'}</strong><small><span>{network}</span>{post.handle ? ` · @${String(post.handle).replace(/^@/, '')}` : ''} · {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('pt-BR') : 'Publicação recente'} · {post.commentCount || 0} comentários</small></div>
        <div className="inbox-item-actions">{count > 0 && <span className="inbox-unanswered-badge">{count} não respondido{count > 1 ? 's' : ''}</span>}<button type="button" className="action-button" onClick={() => setSelectedPostId(post.id)}>Abrir conversa</button></div>
      </article>
    })}</div></div><div className="inbox-conversation-pane">{selectedPostId != null ? <CommentsModal embedded postId={selectedPostId} initialPost={selectedPost} onClose={handleConversationClose} onReplySent={handleReplySent}/> : <div className="inbox-conversation-empty"><span aria-hidden="true">💬</span><strong>Selecione uma publicação</strong><p>Os comentários e as respostas aparecerão aqui.</p></div>}</div></div> : <div className="inbox-empty"><span aria-hidden="true">◎</span><p>{search ? 'Nenhuma publicação corresponde à busca.' : 'Nenhuma interação encontrada.'}</p>{(search || statusFilter !== 'all' || platform !== 'all') && <button className="link-button" onClick={() => { setSearch(''); setPlatform('all'); setStatusFilter('all') }}>Limpar filtros</button>}</div>}
  </section></section>
}
