import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'
import { useToast } from '../components/ui/toast.jsx'

const PLATFORM_BADGE_BG = { instagram: 'bg-[#E1306C]/15', facebook: 'bg-[#1877F2]/15', tiktok: 'bg-zinc-100/10', x: 'bg-zinc-100/10' }
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const CALENDAR_VIEW_KEY = 'meu-ecoo:calendar-view'
const platformsOf = post => post.platforms || post.plataformas || (post.platform ? [post.platform] : [])

function CalendarDayPost({ post, onEdit, onRemove, onDuplicate }) {
  const primaryPlatform = platformsOf(post)[0]
  return (
    <div className="group rounded-lg border border-subtle bg-surface-soft/60 px-2 py-1.5 text-xs text-zinc-300">
      <div className="flex items-center gap-2">
        {primaryPlatform && (
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${PLATFORM_BADGE_BG[primaryPlatform] || 'bg-zinc-100/10'}`}>
            <PlatformIcon platform={primaryPlatform} className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="truncate leading-tight">{post.text || post.title || 'Publicação'}</span>
      </div>
      <div className="mt-1 hidden gap-2 group-hover:flex">
        <button className="text-[11px] font-medium text-gold hover:underline" onClick={onEdit}>Editar</button>
        <button className="text-[11px] font-medium text-gold hover:underline" onClick={onDuplicate}>Duplicar</button>
        <button className="text-[11px] font-medium text-red-400 hover:underline" onClick={onRemove}>Excluir</button>
      </div>
    </div>
  )
}

export function CalendarPage({ onNavigate }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [editing, setEditing] = useState(null)
  const [date, setDate] = useState('')
  const [platformFilter, setPlatformFilter] = useState(() => localStorage.getItem(`${CALENDAR_VIEW_KEY}:platform`) || 'all')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(CALENDAR_VIEW_KEY) || 'calendar')
  const notify = useToast()
  const [message, setMessage] = useState('')
  const load = useCallback(() => apiFetch(`/api/posts/calendar?year=${year}&month=${month}`).then(data => data.posts || []), [month, year])
  const { value: posts, loading, error, setError, reload } = useApiResource(load, [])

  useEffect(() => { localStorage.setItem(`${CALENDAR_VIEW_KEY}:platform`, platformFilter) }, [platformFilter])
  useEffect(() => { localStorage.setItem(CALENDAR_VIEW_KEY, viewMode) }, [viewMode])

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

  async function remove(post) {
    if (!window.confirm('Excluir esta publicação?')) return
    try { await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' }); setMessage('Publicação excluída.'); await reload(); notify('Publicação excluída.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
  }

  async function reschedule(event) {
    event.preventDefault()
    try { await apiFetch(`/api/posts/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: date }) }); setEditing(null); setMessage('Publicação reagendada.'); await reload(); notify('Publicação reagendada.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
  }

  function duplicate(post) {
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({
      text: post.text || '',
      selected: platformsOf(post),
      publishNow: false,
      date: '',
      savedAt: new Date().toISOString()
    }))
    notify('Publicação duplicada no editor. Adicione a mídia e escolha um novo horário.')
    onNavigate?.('agendador')
  }

  const days = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const filteredPosts = posts.filter(post => platformFilter === 'all' || platformsOf(post).includes(platformFilter))
  const sortedPosts = [...filteredPosts].sort((a, b) => new Date(a.scheduled_at || a.scheduledAt || a.data_agendamento) - new Date(b.scheduled_at || b.scheduledAt || b.data_agendamento))

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-[0.1em] text-gold-muted">PLANEJAMENTO</p>
          <h2 className="text-2xl font-semibold text-zinc-50">{monthNames[month - 1]} de {year}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={goToToday} className="rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Hoje</button>
          <button onClick={() => shift(-1)} className="rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Anterior</button>
          <button onClick={() => shift(1)} className="rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Próximo</button>
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
          const dayPosts = filteredPosts.filter(post => new Date(post.scheduled_at || post.scheduledAt || post.data_agendamento).getDate() === day)
          const today = new Date()
          const isToday = today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === day
          return (
            <div key={day} aria-label={`${day} de ${monthNames[month - 1]} de ${year}${isToday ? ', hoje' : ''}`} className={`calendar-day-cell min-h-[112px] border-b border-r border-subtle p-2 last:border-r-0${isToday ? ' is-today' : ''}`}>
              <div className="flex items-center justify-between">
                <strong className="text-xs font-medium text-zinc-500">{day}{isToday && <span className="calendar-today-label">Hoje</span>}</strong>
                {dayPosts.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
              </div>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {dayPosts.map(post => (
                  <CalendarDayPost
                    key={post.id}
                    post={post}
                    onEdit={() => { setEditing(post); setDate((post.scheduled_at || post.scheduledAt || '').slice(0, 16)) }}
                    onDuplicate={() => duplicate(post)}
                    onRemove={() => remove(post)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div></div> : <div className="calendar-list-view">{sortedPosts.length ? sortedPosts.map(post => <article className="calendar-list-item" key={post.id}><span className="calendar-list-date">{new Date(post.scheduled_at || post.scheduledAt || post.data_agendamento).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span><span className="calendar-list-platforms">{platformsOf(post).map(platform => <span key={platform} className={`calendar-list-platform calendar-list-platform-${platform}`}><PlatformIcon platform={platform} className="h-3.5 w-3.5"/>{PLATFORM_LABELS[platform] || platform}</span>)}</span><strong>{post.text || post.title || 'Publicação'}</strong><span className="calendar-list-actions"><button className="link-button" onClick={() => { setEditing(post); setDate((post.scheduled_at || post.scheduledAt || '').slice(0, 16)) }}>Editar</button><button className="link-button" onClick={() => duplicate(post)}>Duplicar</button><button className="link-button danger-link" onClick={() => remove(post)}>Excluir</button></span></article>) : <p className="empty-state">Nenhuma publicação neste filtro.</p>}</div>}

      {editing && (
        <section className="mt-6 rounded-xl border border-subtle bg-surface p-5">
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
