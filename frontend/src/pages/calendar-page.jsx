import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'
import { useToast } from '../components/ui/toast.jsx'
import '../styles/calendar.css'

const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
const CALENDAR_VIEW_KEY = 'meu-ecoo:calendar-view'
const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const platformsOf = post => post.platforms || post.plataformas || (post.platform ? [post.platform] : [])
const postDateValue = post => post.calendarAt || post.calendar_at || post.publishedAt || post.published_at || post.scheduledAt || post.scheduled_at || post.data_agendamento
const normalizePostStatus = post => String(post.status || '').trim().toLowerCase()
const postStatusLabel = { scheduled: 'Agendado', agendado: 'Agendado', published: 'Publicado', publicado: 'Publicado', processing: 'Publicando', processando: 'Publicando', partial: 'Parcial', parcial: 'Parcial', error: 'Erro', erro: 'Erro' }
const isScheduled = post => ['scheduled', 'agendado'].includes(normalizePostStatus(post))

function postStatusMessage(post) {
  const status = normalizePostStatus(post)
  if (status === 'published' || status === 'publicado') return { type: 'success', title: 'Publicado com sucesso', detail: 'A publicação foi confirmada nas redes selecionadas.' }
  if (status === 'partial' || status === 'parcial') return { type: 'warning', title: 'Publicado parcialmente', detail: 'A publicação foi confirmada em algumas redes e falhou em outra.' }
  if (status === 'processing' || status === 'processando') return { type: 'processing', title: 'Publicação em andamento', detail: 'O sistema está enviando o conteúdo para as redes selecionadas.' }
  if (status === 'error' || status === 'erro') return { type: 'error', title: 'Não foi possível publicar', detail: friendlyPostError(post) || 'Confira o histórico ou as conexões das redes selecionadas.' }
  const scheduledAt = new Date(postDateValue(post))
  if (isScheduled(post) && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() <= Date.now()) return { type: 'pending', title: 'Aguardando confirmação da publicação', detail: 'O horário agendado já passou, mas ainda não recebemos a confirmação da rede social.' }
  return { type: 'scheduled', title: 'Publicação agendada', detail: 'Ela será enviada no dia e horário definidos.' }
}

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

function isAccountError(detail) {
  return /conta.*(?:não encontrada|nao encontrada|não encontrado|nao encontrado|desconect)|token|autoriz|permiss|access|\b401\b|\b403\b|reconect/i.test(detail)
}

function isUnavailableError(detail) {
  return !isAccountError(detail) && /não existe|nao existe|não encontrado|nao encontrado|remov|apag|deleted|removed|does not exist|cannot be loaded/i.test(detail)
}

// A ação disponível no calendário depende da causa registrada. Em especial,
// uma falha de conteúdo ou autorização não deve ser reenviada sem revisão.
function postFailureKind(post) {
  const detail = String(post.errorMessage || post.error_message || '').trim().toLowerCase()
  if (!detail) return 'unknown'
  if (isAccountError(detail)) return 'account'
  if (isUnavailableError(detail)) return 'unavailable'
  if (/processamento interrompido|aguardando confirmação|timeout|timed out|econnreset|etimedout|enotfound|fetch failed|network|rate.?limit|too many requests|temporariamente indispon|service unavailable|gateway timeout|\b(408|425|429|500|502|503|504|529)\b/.test(detail)) return 'retryable'
  if (/imagem|image|vídeo|video|mídia|media|formato|tamanho|caract|caption|texto|obrigat|conteúdo|content|duplicate|duplicad/.test(detail)) return 'content'
  return 'unknown'
}

function parseMediaItems(post) {
  const rawItems = Array.isArray(post.mediaItems)
    ? post.mediaItems
    : typeof post.mediaItems === 'string'
      ? (() => { try { return JSON.parse(post.mediaItems) } catch { return [] } })()
      : []
  const items = rawItems.filter(item => item && (item.path || item.url))
  if (items.length) return items
  return post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType || 'image' }] : []
}

function postText(post, platform = platformsOf(post)[0]) {
  const textByPlatform = post.textByPlatform && typeof post.textByPlatform === 'object' ? post.textByPlatform : {}
  return textByPlatform[platform] || post.text || post.title || post.youtubeTitle || 'Publicação'
}

function CalendarPlatformBadges({ platforms, compact = false }) {
  if (!platforms.length) return null
  return <span className={`calendar-platform-badges${compact ? ' is-compact' : ''}`} aria-label={`Redes: ${platforms.map(platform => PLATFORM_LABELS[platform] || platform).join(', ')}`}>
    {platforms.map(platform => <span key={platform} className={`calendar-platform-badge calendar-platform-badge-${platform}`} title={PLATFORM_LABELS[platform] || platform}><PlatformIcon platform={platform} className={compact ? 'h-3 w-3' : 'h-4 w-4'} /></span>)}
  </span>
}

function friendlyPostError(post) {
  const detail = String(post.errorMessage || '').trim()
  if (isUnavailableError(detail)) return 'Esta publicação não está mais disponível na rede social. O registro foi mantido no calendário.'
  if (['partial', 'parcial'].includes(normalizePostStatus(post))) return 'A publicação foi concluída em algumas redes, mas houve uma falha em outra.'
  if (['error', 'erro'].includes(normalizePostStatus(post))) {
    // O backend já remove credenciais e limita mensagens externas; mostrar o
    // detalhe real evita esconder causas acionáveis como duplicidade, limite
    // da plataforma ou conta desconectada.
    if (detail) return detail.slice(0, 320)
    return 'Não foi possível confirmar esta publicação na rede social. O histórico foi mantido.'
  }
  return ''
}

function CalendarMediaPreview({ post, compact = false }) {
  const item = parseMediaItems(post)[0]
  const source = item?.path || item?.url
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [source])

  if (!source) return null
  if (failed) return <div className={`calendar-media-unavailable${compact ? ' is-compact' : ''}`} role="status">Prévia indisponível. A publicação pode ter sido removida da rede social.</div>
  if (item.type === 'video' || item.mimetype?.startsWith('video/')) {
    return <video className={`calendar-media-preview${compact ? ' is-compact' : ''}`} src={source} muted playsInline controls={!compact} preload="metadata" onError={() => setFailed(true)} aria-label="Prévia do vídeo publicado" />
  }
  return <img className={`calendar-media-preview${compact ? ' is-compact' : ''}`} src={source} alt="Prévia do conteúdo publicado" onError={() => setFailed(true)} />
}

function CalendarDayPost({ post, onDelete, onReview, onOpenIntegrations }) {
  const platforms = platformsOf(post)
  const primaryPlatform = platforms[0]
  const error = friendlyPostError(post)
  const status = normalizePostStatus(post)
  const failureKind = postFailureKind(post)
  const scheduled = isScheduled(post)
  const statusMessage = postStatusMessage(post)
  return (
    <article className="calendar-detail-post">
      <div className="flex items-center gap-2">
        <time className="calendar-detail-time">{formatPostTime(post)}</time>
        <CalendarPlatformBadges platforms={platforms} />
        <span className="calendar-detail-copy">{postText(post, primaryPlatform)}</span>
        <span className={`calendar-detail-status calendar-detail-status-${status || 'unknown'}`}>{postStatusLabel[status] || post.status || 'Sem status'}</span>
      </div>
      <div className="calendar-detail-preview"><CalendarMediaPreview post={post}/>{error && <p className="calendar-post-warning" role="alert">{error}</p>}</div>
      <div className={`calendar-post-status-message is-${statusMessage.type}`} role={statusMessage.type === 'error' ? 'alert' : 'status'}><span className="calendar-post-status-icon" aria-hidden="true">{statusMessage.type === 'success' ? '✓' : statusMessage.type === 'error' ? '!' : '•'}</span><div><strong>{statusMessage.title}</strong><small>{statusMessage.detail}</small></div></div>
      <div className="calendar-detail-actions">
        {scheduled && <button className="text-[11px] font-medium text-red-400 hover:underline" onClick={onDelete}>Excluir agendamento</button>}
        {failureKind === 'content' && <button className="text-[11px] font-medium text-gold hover:underline" onClick={onReview}>Revisar no editor</button>}
        {failureKind === 'account' && <button className="text-[11px] font-medium text-gold hover:underline" onClick={onOpenIntegrations}>Corrigir conexão</button>}
        {!scheduled && <button className="text-[11px] font-medium text-red-400 hover:underline" onClick={onDelete}>Excluir post publicado</button>}
      </div>
    </article>
  )
}

export function CalendarPage({ onNavigate }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [selectedDay, setSelectedDay] = useState(null)
  const [platformFilter, setPlatformFilter] = useState(() => localStorage.getItem(`${CALENDAR_VIEW_KEY}:platform`) || 'all')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(CALENDAR_VIEW_KEY) || 'calendar')
  const notify = useToast()
  const [message, setMessage] = useState('')
  const load = useCallback(() => apiFetch(`/api/posts/calendar?year=${year}&month=${month}`).then(data => data.posts || []), [month, year])
  const { value: posts, loading, error, setError, reload } = useApiResource(load, [])

  useEffect(() => {
    const interval = window.setInterval(() => { reload().catch(() => {}) }, 30_000)
    return () => window.clearInterval(interval)
  }, [reload])

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

  async function deletePublished(post) {
    const label = postText(post)
    if (!window.confirm(`Excluir “${label}” do calendário?\n\nO registro será removido do Meu Ecoo, mas a publicação original continuará nas redes sociais.`)) return
    try {
      await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' })
      setSelectedDay(null)
      setMessage('Publicação removida do calendário.')
      await reload()
      notify('Publicação removida do calendário.')
    } catch (e) { setError(e.message); notify(e.message, 'error') }
  }

  async function deleteScheduled(post) {
    const label = postText(post)
    if (!window.confirm(`Excluir o agendamento “${label}”?\n\nEle será removido do calendário e não será publicado.`)) return
    try {
      await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' })
      setSelectedDay(null)
      setMessage('Agendamento excluído.')
      await reload()
      notify('Agendamento excluído.')
    } catch (e) { setError(e.message); notify(e.message, 'error') }
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
    setSelectedDay({ day })
  }

  function openPostComposer() {
    const savedAt = new Date().toISOString()
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({
      textByPlatform: {},
      titleByPlatform: {},
      date: '',
      publishNow: true,
      approvalWorkspaceId: '',
      selected: ['instagram'],
      youtubeTitle: '',
      youtubeVisibility: 'public',
      youtubeMadeForKids: '',
      youtubeFormat: '',
      igFormat: 'post',
      igAspect: 'auto',
      facebookFormat: 'post',
      tiktokAspect: 'auto',
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      savedAt
    }))
    setSelectedDay(null)
    onNavigate('agendador')
  }

  function reviewFailure(post) {
    const selected = Array.isArray(post.platforms) && post.platforms.length ? post.platforms : ['instagram']
    const textByPlatform = post.textByPlatform && typeof post.textByPlatform === 'object'
      ? post.textByPlatform
      : Object.fromEntries(selected.map(platform => [platform, post.text || '']))
    const media = parseMediaItems(post)[0]
    const mediaPath = media?.path || media?.url
    if (mediaPath) {
      sessionStorage.setItem('meu-ecoo:media-library-selection', JSON.stringify({
        url: mediaPath,
        name: media?.name || 'Mídia da publicação',
        mimeType: media?.type || media?.mimetype || post.mediaType || 'application/octet-stream'
      }))
    } else sessionStorage.removeItem('meu-ecoo:media-library-selection')
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({
      text: post.text || '',
      textByPlatform,
      titleByPlatform: post.titleByPlatform && typeof post.titleByPlatform === 'object' ? post.titleByPlatform : {},
      selected,
      publishNow: true,
      date: '',
      youtubeTitle: post.youtubeTitle || '',
      youtubeVisibility: post.youtubeVisibility || 'public',
      youtubeMadeForKids: post.youtubeMadeForKids == null ? '' : String(post.youtubeMadeForKids),
      youtubeCategoryId: post.youtubeCategoryId || '',
      youtubeFormat: post.youtubeFormat || '',
      igFormat: post.igFormat || 'post',
      facebookFormat: post.facebookFormat || 'post',
      tiktokPrivacyLevel: post.tiktokPrivacyLevel || 'PUBLIC_TO_EVERYONE',
      tiktokDisableComment: Boolean(post.tiktokDisableComment),
      tiktokDisableDuet: Boolean(post.tiktokDisableDuet),
      tiktokDisableStitch: Boolean(post.tiktokDisableStitch),
      sourceFailureId: post.id,
      savedAt: new Date().toISOString()
    }))
    onNavigate('agendador')
  }

  const selectedDayPosts = selectedDay ? postsForDay(selectedDay.day) : []

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

      {message && <div className="calendar-copy-notice is-complete" role="status"><span className="calendar-copy-notice-icon" aria-hidden="true">✓</span><div className="calendar-copy-notice-copy"><span className="calendar-copy-notice-kicker">CALENDÁRIO ATUALIZADO</span><strong>Calendário atualizado</strong><p>{message}</p></div></div>}
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
                {dayPosts.slice(0, 3).map(post => <span className="calendar-day-event" key={post.id || `${postDateValue(post)}-${post.text}`}><time>{formatPostTime(post)}</time><CalendarPlatformBadges platforms={platformsOf(post)} compact/><span>{postText(post)}</span></span>)}
                {dayPosts.length > 3 && <span className="calendar-day-more">+{dayPosts.length - 3} mais</span>}
              </div>
            </button>
          )
        })}
      </div></div> : <div className="calendar-list-view">{sortedPosts.length ? sortedPosts.map(post => { const failureKind = postFailureKind(post); return <article className="calendar-list-item" key={post.id}><CalendarMediaPreview post={post} compact/><span className="calendar-list-date">{new Date(postDateValue(post)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span><span className="calendar-list-platforms">{platformsOf(post).map(platform => <span key={platform} className={`calendar-list-platform calendar-list-platform-${platform}`}><PlatformIcon platform={platform} className="h-3.5 w-3.5"/>{PLATFORM_LABELS[platform] || platform}</span>)}</span><div className="calendar-list-copy"><strong>{postText(post)}</strong><small className={`calendar-list-status is-${postStatusMessage(post).type}`}>{postStatusMessage(post).title}</small>{friendlyPostError(post) && <small className="calendar-post-warning">{friendlyPostError(post)}</small>}</div><span className="calendar-list-actions">{isScheduled(post) && <button className="link-button text-red-400" onClick={() => deleteScheduled(post)}>Excluir</button>}{failureKind === 'content' && <button className="link-button" onClick={() => reviewFailure(post)}>Revisar</button>}{failureKind === 'account' && <button className="link-button" onClick={() => onNavigate('integracoes')}>Conexão</button>}</span></article> }) : <p className="empty-state">Nenhuma publicação neste filtro.</p>}</div>}

      {selectedDay && <div className="modal-overlay calendar-day-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDay(null) }}>
        <section className="modal-content" role="dialog" aria-modal="true" aria-labelledby="calendar-day-modal-title">
          <div className="modal-header">
            <div>
              <p className="eyebrow">AGENDA DO DIA</p>
              <h2 id="calendar-day-modal-title">{selectedDay.day} de {monthNames[month - 1]}</h2>
            </div>
            <button type="button" className="link-button" onClick={() => setSelectedDay(null)} aria-label="Fechar publicações do dia">Fechar</button>
          </div>
          {selectedDayPosts.length ? <div className="calendar-day-details">{selectedDayPosts.map(post => <CalendarDayPost key={post.id || `${postDateValue(post)}-${post.text}`} post={post} onReview={() => reviewFailure(post)} onOpenIntegrations={() => onNavigate('integracoes')} onDelete={() => isScheduled(post) ? deleteScheduled(post) : deletePublished(post)}/>)}</div> : <p className="empty-state">Nenhuma publicação neste dia.</p>}
          <div className="calendar-day-create-actions">
            <div>
              <p className="calendar-day-create-kicker">PLANEJE ESTE DIA</p>
              <strong>Quer publicar mais alguma coisa?</strong>
              <span>Abra o Meu Post para criar e publicar o conteúdo agora.</span>
            </div>
            <div className="calendar-day-create-buttons">
              <button type="button" className="calendar-day-create-button is-secondary" onClick={openPostComposer}>
                Criar post
              </button>
            </div>
          </div>
        </section>
      </div>}

    </section>
  )
}
