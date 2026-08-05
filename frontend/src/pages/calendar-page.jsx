import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'
import { useToast } from '../components/ui/toast.jsx'

const PLATFORM_BADGE_BG = { instagram: 'bg-[#E1306C]/15', facebook: 'bg-[#1877F2]/15', tiktok: 'bg-zinc-100/10', x: 'bg-zinc-100/10' }
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
const CALENDAR_VIEW_KEY = 'meu-ecoo:calendar-view'
const platformsOf = post => post.platforms || post.plataformas || (post.platform ? [post.platform] : [])
const postDateValue = post => post.calendarAt || post.calendar_at || post.publishedAt || post.published_at || post.scheduledAt || post.scheduled_at || post.data_agendamento
const postStatusLabel = { scheduled: 'Agendado', published: 'Publicado', processing: 'Publicando', partial: 'Parcial', error: 'Erro' }
const isScheduled = post => ['scheduled', 'agendado'].includes(post.status)

function uniquePosts(items) {
  const seen = new Set()
  return items.filter(post => {
    const key = post.id != null ? `id:${post.id}` : `fallback:${postDateValue(post)}:${post.text || post.title || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatPostTime(post) {
  const value = new Date(postDateValue(post))
  return Number.isNaN(value.getTime()) ? 'Horário não informado' : value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function CalendarDayPost({ post, onEdit }) {
  const primaryPlatform = platformsOf(post)[0]
  return (
    <article className="calendar-detail-post">
      <div className="flex items-center gap-2">
        <time className="calendar-detail-time">{formatPostTime(post)}</time>
        {primaryPlatform && (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${PLATFORM_BADGE_BG[primaryPlatform] || 'bg-zinc-100/10'}`}>
            <PlatformIcon platform={primaryPlatform} className="h-4 w-4" />
          </span>
        )}
        <span className="calendar-detail-copy">{post.text || post.title || 'Publicação'}</span>
        <span className={`calendar-detail-status calendar-detail-status-${post.status || 'unknown'}`}>{postStatusLabel[post.status] || post.status || 'Sem status'}</span>
      </div>
      {isScheduled(post) && <div className="calendar-detail-actions"><button className="text-[11px] font-medium text-gold hover:underline" onClick={onEdit}>Editar</button></div>}
    </article>
  )
}

export function CalendarPage({ onNavigate }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [editing, setEditing] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [date, setDate] = useState('')
  const [platformFilter, setPlatformFilter] = useState(() => localStorage.getItem(`${CALENDAR_VIEW_KEY}:platform`) || 'all')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(CALENDAR_VIEW_KEY) || 'calendar')
  const notify = useToast()
  const [message, setMessage] = useState('')
  const load = useCallback(() => apiFetch(`/api/posts/calendar?year=${year}&month=${month}`).then(data => data.posts || []), [month, year])
  const { value: posts, loading, error, setError, reload } = useApiResource(load, [])

  useEffect(() => { localStorage.setItem(`${CALENDAR_VIEW_KEY}:platform`, platformFilter) }, [platformFilter])
  useEffect(() => { localStorage.setItem(CALENDAR_VIEW_KEY, viewMode) }, [viewMode])
  useEffect(() => {
    if (!selectedDay) return undefined
    const closeOnEscape = event => { if (event.key === 'Escape') setSelectedDay(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedDay])

  function shift(delta) {
    const next = new Date(year, month - 1 + delta, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth() + 1)
    setMessage('')
  }

  function goToToday() {
    const today = new Date()
    setYear(today.getFullYear())
    setMonth(today.getMonth() + 1)
    setMessage('')
  }

  async function reschedule(event) {
    event.preventDefault()
    try { await apiFetch(`/api/posts/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: date }) }); setEditing(null); setMessage('Publicação reagendada.'); await reload(); notify('Publicação reagendada.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
  }

  const days = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const normalizedPosts = uniquePosts(posts)
  const filteredPosts = normalizedPosts.filter(post => platformFilter === 'all' || platformsOf(post).includes(platformFilter))
  const sortedPosts = [...filteredPosts].sort((a, b) => new Date(postDateValue(a)) - new Date(postDateValue(b)))

  function postsForDay(day) {
    return filteredPosts
      .filter(post => {
        const value = new Date(postDateValue(post))
        return value.getFullYear() === year && value.getMonth() + 1 === month && value.getDate() === day
      })
      .sort((a, b) => new Date(postDateValue(a)) - new Date(postDateValue(b)))
  }

  function openDay(day) {
    setSelectedDay({ day, posts: postsForDay(day) })
  }

  function openEditor(post) {
    setEditing(post)
    setDate(postDateValue(post)?.slice(0, 16) || '')
    setSelectedDay(null)
  }

  return (
    <section className="page-view calendar-page">
      <div className="calendar-page-heading mb-6 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-[0.1em] text-gold-muted">PLANEJAMENTO</p>
          <h2 className="text-2xl font-semibold text-zinc-50">{monthNames[month - 1]} de {year}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={goToToday} className="calendar-nav-button rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Hoje</button>
          <button onClick={() => shift(-1)} className="calendar-nav-button rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Anterior</button>
          <button onClick={() => shift(1)} className="calendar-nav-button rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Próximo</button>
        </div>
      </div>

      <div className="calendar-toolbar">
        <label>Rede<select value={platformFilter} onChange={event => setPlatformFilter(event.target.value)} aria-label="Filtrar calendário por rede"><option value="all">Todas as redes</option>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <span className="calendar-toolbar-summary">{filteredPosts.length} {filteredPosts.length === 1 ? 'publicação encontrada' : 'publicações encontradas'}</span>
        <div className="calendar-view-toggle" role="group" aria-label="Modo de visualização"><button type="button" className={viewMode === 'calendar' ? 'active' : ''} onClick={() => setViewMode('calendar')}>Calendário</button><button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>Lista</button></div>
      </div>

      {message && <p className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-500">{message}</p>}
      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400" role="alert">{error}</p>}
      {loading && <p className="mb-4 text-sm text-zinc-500" aria-live="polite">Carregando publicações do mês...</p>}

      {viewMode === 'calendar' ? <div className="calendar-grid-scroll"><div className="grid min-w-[680px] grid-cols-7 overflow-hidden rounded-xl border border-subtle bg-surface">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(label => (
          <div key={label} className="border-b border-subtle px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gold-muted">
            {label}
          </div>
        ))}

        {Array.from({ length: firstWeekday }, (_, index) => (
          <div key={`empty-${index}`} className="min-h-[112px] border-b border-r border-subtle bg-app/40" />
        ))}

        {Array.from({ length: days }, (_, index) => {
          const day = index + 1
          const dayPosts = postsForDay(day)
          const today = new Date()
          const isToday = today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === day
          return (
            <button type="button" key={day} aria-label={`Abrir publicações de ${day} de ${monthNames[month - 1]} de ${year}${isToday ? ', hoje' : ''}`} className={`calendar-day-cell min-h-[92px] border-b border-r border-subtle p-2 text-left last:border-r-0${isToday ? ' is-today' : ''}`} onClick={() => openDay(day)}>
              <div className="calendar-day-heading flex items-center justify-between">
                <strong className="text-xs font-medium text-zinc-500">{day}{isToday && <span className="calendar-today-label">Hoje</span>}</strong>
                {dayPosts.length > 0 && <span className="calendar-day-count">{dayPosts.length}</span>}
              </div>
              <div className="calendar-day-events">
                {dayPosts.slice(0, 3).map(post => <span className="calendar-day-event" key={post.id || `${postDateValue(post)}-${post.text}`}><time>{formatPostTime(post)}</time><span>{post.text || post.title || 'Publicação'}</span></span>)}
                {dayPosts.length > 3 && <span className="calendar-day-more">+{dayPosts.length - 3} mais</span>}
              </div>
            </button>
          )
        })}
      </div></div> : <div className="calendar-list-view">{sortedPosts.length ? sortedPosts.map(post => <article className="calendar-list-item" key={post.id}><span className="calendar-list-date">{new Date(postDateValue(post)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span><span className="calendar-list-platforms">{platformsOf(post).map(platform => <span key={platform} className={`calendar-list-platform calendar-list-platform-${platform}`}><PlatformIcon platform={platform} className="h-3.5 w-3.5"/>{PLATFORM_LABELS[platform] || platform}</span>)}</span><strong>{post.text || post.title || 'Publicação'}</strong><span className="calendar-list-actions">{isScheduled(post) && <button className="link-button" onClick={() => openEditor(post)}>Editar</button>}</span></article>) : <p className="empty-state">Nenhuma publicação neste filtro.</p>}</div>}

      {selectedDay && <div className="modal-overlay calendar-day-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDay(null) }}>
        <section className="modal-content" role="dialog" aria-modal="true" aria-labelledby="calendar-day-modal-title">
          <div className="modal-header">
            <div>
              <p className="eyebrow">AGENDA DO DIA</p>
              <h2 id="calendar-day-modal-title">{selectedDay.day} de {monthNames[month - 1]}</h2>
            </div>
            <button type="button" className="link-button" onClick={() => setSelectedDay(null)} aria-label="Fechar publicações do dia">Fechar</button>
          </div>
          {selectedDay.posts.length ? <div className="calendar-day-details">{selectedDay.posts.map(post => <CalendarDayPost key={post.id || `${postDateValue(post)}-${post.text}`} post={post} onEdit={() => openEditor(post)}/>)}</div> : <p className="empty-state">Nenhuma publicação neste dia.</p>}
        </section>
      </div>}

      {editing && (
        <section className="calendar-edit-panel mt-6 rounded-xl border border-subtle bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold text-zinc-50">Reagendar publicação</h2>
          <form className="flex flex-wrap items-center gap-3" onSubmit={reschedule}>
            <input
              required
              type="datetime-local"
              value={date}
              onChange={event => setDate(event.target.value)}
              className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100"
            />
            <button className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110">Salvar</button>
            <button type="button" className="text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setEditing(null)}>Cancelar</button>
          </form>
        </section>
      )}
    </section>
  )
}
