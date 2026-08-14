import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'

const platforms = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']]
const days = [['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['0', 'Dom']]

export function ContentQueuesPage() {
  const [queues, setQueues] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [media, setMedia] = useState(null)
  const [form, setForm] = useState({ name: '', text: '', platforms: ['instagram'], days: ['1', '3', '5'], time: '10:00' })
  const notify = useToast()
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/api/content-queues')
      setQueues(data.queues || [])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load().catch(error => notify(error.message, 'error')) }, [load, notify])
  function togglePlatform(platform) {
    setForm(current => ({ ...current, platforms: current.platforms.includes(platform) ? current.platforms.filter(item => item !== platform) : [...current.platforms, platform] }))
    if (platform === 'tiktok' && !form.platforms.includes(platform) && media && !media.file.type.startsWith('video/')) {
      notify('O TikTok aceita somente um vídeo. Troque a imagem antes de criar a rotina.', 'error')
    }
  }
  function toggleDay(day) { setForm(current => ({ ...current, days: current.days.includes(day) ? current.days.filter(item => item !== day) : [...current.days, day] })) }
  function selectMedia(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      notify('Escolha uma imagem ou vídeo válido.', 'error')
      return
    }
    if (form.platforms.includes('tiktok') && !file.type.startsWith('video/')) {
      notify('O TikTok aceita somente um vídeo.', 'error')
      return
    }
    setMedia(current => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl)
      return { file, previewUrl: URL.createObjectURL(file) }
    })
  }
  function removeMedia() {
    setMedia(current => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl)
      return null
    })
  }
  async function uploadMedia(file) {
    const signed = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
    const response = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!response.ok) throw new Error(`Não foi possível enviar ${file.name}.`)
    const uploaded = await response.json().catch(() => null)
    if (!uploaded?.url) throw new Error('O upload não retornou uma URL pública válida.')
    return uploaded.url
  }
  async function save(event) {
    event.preventDefault()
    if (!form.platforms.length || !form.days.length) return notify('Selecione ao menos uma rede e um dia.', 'error')
    if (form.platforms.some(platform => ['instagram', 'youtube', 'tiktok'].includes(platform)) && !media) return notify('Instagram, YouTube e TikTok precisam de mídia anexada.', 'error')
    if (form.platforms.includes('youtube') && media && !media.file.type.startsWith('video/')) return notify('O YouTube precisa de um vídeo anexado.', 'error')
    if (form.platforms.includes('tiktok') && media && !media.file.type.startsWith('video/')) return notify('O TikTok aceita somente um vídeo.', 'error')
    setSaving(true)
    try {
      const mediaPath = media ? await uploadMedia(media.file) : null
      await apiFetch('/api/content-queues', { method: 'POST', body: JSON.stringify({ name: form.name, platforms: form.platforms, content: { text: form.text, ...(mediaPath ? { mediaPath, mediaType: media.file.type, mediaName: media.file.name } : {}) }, recurrence: { days: form.days.map(Number), time: form.time } }) })
      setForm(current => ({ ...current, name: '', text: '' }))
      removeMedia()
      await load()
      notify('Rotina de publicação criada.')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }
  async function toggle(queue) { try { await apiFetch(`/api/content-queues/${queue.id}`, { method: 'PATCH', body: JSON.stringify({ active: !queue.active, recurrence: queue.recurrence }) }); await load() } catch (error) { notify(error.message, 'error') } }
  async function remove(queue) { if (!window.confirm(`Excluir a rotina ${queue.name}?`)) return; try { await apiFetch(`/api/content-queues/${queue.id}`, { method: 'DELETE' }); setQueues(current => current.filter(item => item.id !== queue.id)); notify('Rotina removida.') } catch (error) { notify(error.message, 'error') } }
  const activeQueues = queues.filter(queue => queue.active).length
  const pausedQueues = queues.length - activeQueues
  const filteredQueues = queues.filter(queue => {
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? queue.active : !queue.active)
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR')
    const matchesSearch = !normalizedSearch || [queue.name, queue.content?.text, ...(queue.platforms || [])]
      .filter(Boolean)
      .some(value => String(value).toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    return matchesStatus && matchesSearch
  })
  const selectedDays = days.filter(([id]) => form.days.includes(id)).map(([, label]) => label)
  const selectedPlatforms = platforms.filter(([id]) => form.platforms.includes(id)).map(([, label]) => label)
  const selectedPlatformsLabel = selectedPlatforms.length === 1 ? '1 rede selecionada' : `${selectedPlatforms.length} redes selecionadas`
  const mediaRequired = form.platforms.some(platform => ['instagram', 'youtube', 'tiktok'].includes(platform))
  const videoOnly = form.platforms.includes('tiktok') || form.platforms.includes('youtube')

  function formatQueueDays(queue) {
    const queueDays = queue.recurrence?.days || []
    const labels = days.filter(([id]) => queueDays.includes(Number(id)) || queueDays.includes(id)).map(([, label]) => label)
    return labels.length ? labels.join(' · ') : 'Dias não definidos'
  }

  function formatNextRun(queue) {
    return queue.nextRunAt
      ? new Date(queue.nextRunAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Pausada'
  }

  return <section className="page-view queues-page">
    <header className="queues-hero">
      <div className="queues-hero-copy">
        <span className="queues-hero-icon" aria-hidden="true">↻</span>
        <div>
          <p className="eyebrow">AUTOMAÇÃO DE CONTEÚDO</p>
 <h2>Repetidor de posts</h2>
          <p>Crie rotinas que mantêm suas redes ativas com publicações consistentes, sem precisar refazer o mesmo agendamento.</p>
        </div>
      </div>
      <div className="queues-hero-stats" aria-label="Resumo das rotinas">
        <div><strong>{queues.length}</strong><span>Total de rotinas</span></div>
        <div><strong>{activeQueues}</strong><span>Ativas</span></div>
        <div><strong>{pausedQueues}</strong><span>Pausadas</span></div>
      </div>
    </header>

    <div className="queues-layout">
      <form className="panel queues-create-panel" onSubmit={save}>
        <div className="queues-section-heading">
          <div className="queues-section-heading-copy"><span className="queues-section-icon" aria-hidden="true">+</span><div><p className="eyebrow">NOVA ROTINA</p><h3>Criar uma rotina</h3><p>Defina o conteúdo, as redes e os dias em poucos passos.</p></div></div>
          <span className="queues-step-label">1–3</span>
        </div>

        <div className="queues-form-fields">
          <label className="queues-field"><span>Nome da rotina</span><small>Um nome fácil de reconhecer depois.</small><input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ex.: Dicas da semana" required /></label>
          <label className="queues-field"><span>Texto da publicação</span><small>O conteúdo será reutilizado em cada execução da rotina.</small><textarea value={form.text} onChange={event => setForm(current => ({ ...current, text: event.target.value }))} placeholder="Uma ideia que será publicada nos dias selecionados…" required /></label>
<div className="queues-field queues-media-field"><span>Mídia da publicação {mediaRequired ? <em>obrigatória</em> : <em>opcional</em>}</span><small>A mesma mídia será reutilizada em cada execução da rotina.</small><label className={`queues-media-picker${media ? ' has-media' : ''}`}><input type="file" accept={videoOnly ? 'video/*' : 'image/*,video/*'} onChange={selectMedia} /><span className="queues-media-picker-icon" aria-hidden="true">{media?.file.type.startsWith('video/') ? '▶' : '＋'}</span><span><strong>{media ? media.file.name : videoOnly ? 'Escolher vídeo' : 'Escolher imagem ou vídeo'}</strong><small>{media ? `${(media.file.size / 1024 / 1024).toFixed(1)} MB · pronto para enviar` : videoOnly ? 'MP4, MOV ou WebM · até 200 MB' : 'JPG, PNG, WebP, MP4, MOV ou WebM · até 200 MB'}</small></span><span className="queues-media-picker-action">{media ? 'Trocar' : 'Selecionar'}</span></label>{media ? <div className="queues-media-preview">{media.file.type.startsWith('video/') ? <video src={media.previewUrl} muted controls preload="metadata" /> : <img src={media.previewUrl} alt="Prévia da mídia selecionada" />}<button type="button" className="queues-media-remove" onClick={removeMedia}>Remover mídia</button></div> : null}</div>
        </div>

        <fieldset className="queues-fieldset queues-platform-fieldset">
          <legend><span className="queues-legend-copy"><strong>Onde publicar?</strong><small>Escolha uma ou mais redes para esta rotina.</small></span><small className="queues-selection-counter">{selectedPlatforms.length ? selectedPlatformsLabel : 'Nenhuma rede selecionada'}</small></legend>
          <div className="queues-platform-options">
            {platforms.map(([id, label]) => <label className={`queues-platform-option${form.platforms.includes(id) ? ' is-selected' : ''}`} key={id}>
              <input type="checkbox" checked={form.platforms.includes(id)} onChange={() => togglePlatform(id)} />
              <span className={`queues-platform-icon queues-platform-${id}`} aria-hidden="true"><PlatformIcon platform={id} className="queues-platform-svg" /></span>
              <span className="queues-option-copy"><strong>{label}</strong><small>{id === 'instagram' ? 'Feed, Reels e Stories' : id === 'facebook' ? 'Página e perfil' : id === 'youtube' ? 'Canal de vídeos' : 'Vídeos curtos'}</small></span>
              <span className="queues-option-check" aria-hidden="true">{form.platforms.includes(id) ? '✓' : ''}</span>
            </label>)}
          </div>
          <div className={`queues-selected-summary${selectedPlatforms.length ? '' : ' is-empty'}`} role="status">
            <span className="queues-selected-summary-icon" aria-hidden="true">{selectedPlatforms.length ? '✓' : '!'}</span>
            <span>{selectedPlatforms.length ? `O mesmo conteúdo será publicado em ${selectedPlatforms.join(', ')}.` : 'Selecione pelo menos uma rede para continuar.'}</span>
          </div>
        </fieldset>

        <fieldset className="queues-fieldset">
          <legend><span>Quando publicar?</span><small>{selectedDays.length ? selectedDays.join(' · ') : 'Selecione ao menos um dia'}</small></legend>
          <div className="queues-day-options">
            {days.map(([id, label]) => <label className={`queues-day-option${form.days.includes(id) ? ' is-selected' : ''}`} key={id}><input type="checkbox" checked={form.days.includes(id)} onChange={() => toggleDay(id)} /><span>{label}</span></label>)}
          </div>
          <label className="queues-time-field"><span>Horário de publicação</span><input type="time" value={form.time} onChange={event => setForm(current => ({ ...current, time: event.target.value }))} /></label>
        </fieldset>

        <div className="queues-schedule-preview"><span className="queues-preview-icon" aria-hidden="true">◷</span><div><small>PRÓXIMA ROTINA</small><strong>{form.time} · {selectedDays.length ? selectedDays.join(', ') : 'selecione os dias'}</strong><span>{selectedPlatforms.length ? `Publicação em ${selectedPlatforms.join(', ')}` : 'Escolha as redes para continuar'}</span></div></div>
        <button className="action-button queues-submit-button" disabled={saving || !form.platforms.length || !form.days.length || (mediaRequired && !media)}><span aria-hidden="true">{saving ? '↻' : '+'}</span> {saving ? 'Enviando mídia…' : 'Criar rotina'}</button>
      </form>

      <section className="panel queues-list-panel">
        <header className="queues-list-heading">
          <div><p className="eyebrow">SUAS ROTINAS</p><h3>Rotinas configuradas</h3><p>Gerencie o que está ativo e acompanhe a próxima publicação.</p></div>
          <div className="queues-list-heading-actions"><span className="queues-count-badge">{queues.length} {queues.length === 1 ? 'rotina' : 'rotinas'}</span><button type="button" className="queues-refresh-button" onClick={() => load().catch(error => notify(error.message, 'error'))} aria-label="Atualizar rotinas">↻</button></div>
        </header>
        <div className="queues-list-toolbar">
          <label className="queues-search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome ou conteúdo…" aria-label="Buscar rotina" /></label>
          <div className="queues-filter-tabs" role="tablist" aria-label="Filtrar rotinas">
            {[['all', 'Todas', queues.length], ['active', 'Ativas', activeQueues], ['paused', 'Pausadas', pausedQueues]].map(([key, label, count]) => <button type="button" role="tab" aria-selected={statusFilter === key} className={statusFilter === key ? 'is-active' : ''} onClick={() => setStatusFilter(key)} key={key}>{label}<span>{count}</span></button>)}
          </div>
        </div>
        {loading ? <div className="queues-filter-empty"><span className="queues-empty-icon" aria-hidden="true">↻</span><strong>Carregando suas rotinas…</strong></div> : filteredQueues.length ? <div className="queues-list">{filteredQueues.map(queue => <article className={`queues-card${queue.active ? ' is-active' : ' is-paused'}`} key={queue.id}>
          <div className="queues-card-heading"><div className="queues-card-title"><span className="queues-card-icon" aria-hidden="true">↻</span><div><div className="queues-card-name-row"><strong>{queue.name}</strong><span className={`queues-status${queue.active ? ' is-active' : ' is-paused'}`}><i aria-hidden="true" />{queue.active ? 'Ativa' : 'Pausada'}</span></div><small>Criada para repetir automaticamente</small></div></div></div>
          <p className="queues-card-content">“{queue.content?.text || 'Conteúdo por plataforma'}”</p>
          {queue.content?.mediaPath ? <div className="queues-card-media"><span aria-hidden="true">{String(queue.content.mediaType || '').startsWith('video/') ? '▶' : '▧'}</span><span>Mídia anexada{queue.content.mediaName ? ` · ${queue.content.mediaName}` : ''}</span></div> : null}
          <div className="queues-card-details">
            <div><span>HORÁRIO</span><strong>{queue.recurrence?.time || '10:00'}</strong><small>{formatQueueDays(queue)}</small></div>
            <div><span>PRÓXIMA PUBLICAÇÃO</span><strong>{formatNextRun(queue)}</strong><small>{queue.active ? 'Agendamento automático' : 'Ative para retomar'}</small></div>
            <div><span>REDES</span><div className="queues-card-platforms">{(queue.platforms || []).length ? queue.platforms.map(platform => <span className={`queues-card-platform queues-platform-${platform}`} key={platform} title={platform}><PlatformIcon platform={platform} className="queues-platform-svg" /></span>) : <small>Nenhuma rede</small>}</div></div>
          </div>
          <footer className="queues-card-actions"><button type="button" className={`queues-toggle-button${queue.active ? '' : ' is-resume'}`} onClick={() => toggle(queue)}><span aria-hidden="true">{queue.active ? 'Ⅱ' : '▶'}</span>{queue.active ? 'Pausar rotina' : 'Ativar rotina'}</button><button type="button" className="queues-delete-button" onClick={() => remove(queue)}><span aria-hidden="true">⌫</span> Excluir</button></footer>
        </article>)}</div> : queues.length ? <div className="queues-filter-empty"><span className="queues-empty-icon" aria-hidden="true">⌕</span><strong>Nenhuma rotina encontrada</strong><p>Tente outro termo ou limpe os filtros para ver suas rotinas.</p><button type="button" className="link-button" onClick={() => { setSearch(''); setStatusFilter('all') }}>Limpar filtros</button></div> : <div className="queues-empty-state"><span className="queues-empty-icon" aria-hidden="true">↻</span><strong>Nenhuma rotina criada ainda</strong><p>Monte sua primeira rotina ao lado e deixe o conteúdo pronto para voltar à agenda automaticamente.</p></div>}
      </section>
    </div>
  </section>
}
