import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'

const PLATFORM_BADGE_BG = { instagram: 'bg-[#E1306C]/15', facebook: 'bg-[#1877F2]/15', tiktok: 'bg-zinc-100/10', x: 'bg-zinc-100/10' }
const platformsOf = post => post.platforms || post.plataformas || (post.platform ? [post.platform] : [])

function CalendarDayPost({ post, onEdit, onRemove }) {
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
        <button className="text-[11px] font-medium text-red-400 hover:underline" onClick={onRemove}>Excluir</button>
      </div>
    </div>
  )
}

export function CalendarPage() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [editing, setEditing] = useState(null)
  const [date, setDate] = useState('')
  const [message, setMessage] = useState('')
  const load = useCallback(() => apiFetch(`/api/posts/calendar?year=${year}&month=${month}`).then(data => data.posts || []), [month, year])
  const { value: posts, loading, error, setError, reload } = useApiResource(load, [])

  function shift(delta) {
    const next = new Date(year, month - 1 + delta, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth() + 1)
    setMessage('')
  }

  async function remove(post) {
    if (!window.confirm('Excluir esta publicação?')) return
    try { await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' }); setMessage('Publicação excluída.'); await reload() }
    catch (e) { setError(e.message) }
  }

  async function reschedule(event) {
    event.preventDefault()
    try { await apiFetch(`/api/posts/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: date }) }); setEditing(null); setMessage('Publicação reagendada.'); await reload() }
    catch (e) { setError(e.message) }
  }

  const days = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-[0.1em] text-gold-muted">PLANEJAMENTO</p>
          <h2 className="text-2xl font-semibold text-zinc-50">{monthNames[month - 1]} de {year}</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => shift(-1)} className="rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Anterior</button>
          <button onClick={() => shift(1)} className="rounded-lg border border-subtle px-3 py-1.5 text-sm text-zinc-300 hover:border-gold/40 hover:text-gold">Próximo</button>
        </div>
      </div>

      {message && <p className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-500">{message}</p>}
      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400" role="alert">{error}</p>}
      {loading && <p className="mb-4 text-sm text-zinc-500" aria-live="polite">Carregando publicações do mês...</p>}

      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-subtle bg-surface">
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
          const dayPosts = posts.filter(post => new Date(post.scheduled_at || post.scheduledAt || post.data_agendamento).getDate() === day)
          return (
            <div key={day} className="min-h-[112px] border-b border-r border-subtle p-2 last:border-r-0">
              <div className="flex items-center justify-between">
                <strong className="text-xs font-medium text-zinc-500">{day}</strong>
                {dayPosts.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
              </div>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {dayPosts.map(post => (
                  <CalendarDayPost
                    key={post.id}
                    post={post}
                    onEdit={() => { setEditing(post); setDate((post.scheduled_at || post.scheduledAt || '').slice(0, 16)) }}
                    onRemove={() => remove(post)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

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
