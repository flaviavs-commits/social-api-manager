import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'

const platforms = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']]
const days = [['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['0', 'Dom']]

export function ContentQueuesPage() {
  const [queues, setQueues] = useState([])
  const [form, setForm] = useState({ name: '', text: '', platforms: ['instagram'], days: ['1', '3', '5'], time: '10:00' })
  const notify = useToast()
  const load = useCallback(() => apiFetch('/api/content-queues').then(data => setQueues(data.queues || [])), [])
  useEffect(() => { load().catch(error => notify(error.message, 'error')) }, [load, notify])
  function togglePlatform(platform) { setForm(current => ({ ...current, platforms: current.platforms.includes(platform) ? current.platforms.filter(item => item !== platform) : [...current.platforms, platform] })) }
  function toggleDay(day) { setForm(current => ({ ...current, days: current.days.includes(day) ? current.days.filter(item => item !== day) : [...current.days, day] })) }
  async function save(event) { event.preventDefault(); try { await apiFetch('/api/content-queues', { method: 'POST', body: JSON.stringify({ name: form.name, platforms: form.platforms, content: { text: form.text }, recurrence: { days: form.days.map(Number), time: form.time } }) }); setForm(current => ({ ...current, name: '', text: '' })); await load(); notify('Fila recorrente criada.') } catch (error) { notify(error.message, 'error') } }
  async function toggle(queue) { try { await apiFetch(`/api/content-queues/${queue.id}`, { method: 'PATCH', body: JSON.stringify({ active: !queue.active, recurrence: queue.recurrence }) }); await load() } catch (error) { notify(error.message, 'error') } }
  async function remove(queue) { if (!window.confirm(`Excluir a fila ${queue.name}?`)) return; try { await apiFetch(`/api/content-queues/${queue.id}`, { method: 'DELETE' }); setQueues(current => current.filter(item => item.id !== queue.id)); notify('Fila removida.') } catch (error) { notify(error.message, 'error') } }
  const activeQueues = queues.filter(queue => queue.active).length
  const selectedDays = days.filter(([id]) => form.days.includes(id)).map(([, label]) => label)
  const selectedPlatforms = platforms.filter(([id]) => form.platforms.includes(id)).map(([, label]) => label)

  function platformIcon(platform) {
    return ({ instagram: '◎', facebook: 'f', youtube: '▶', tiktok: '♪' })[platform] || '•'
  }

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
          <h2>Filas recorrentes</h2>
          <p>Crie rotinas que mantêm suas redes ativas com publicações consistentes, sem precisar refazer o mesmo agendamento.</p>
        </div>
      </div>
      <div className="queues-hero-stats" aria-label="Resumo das filas">
        <div><strong>{queues.length}</strong><span>Total de filas</span></div>
        <div><strong>{activeQueues}</strong><span>Em execução</span></div>
      </div>
    </header>

    <div className="queues-layout">
      <form className="panel queues-create-panel" onSubmit={save}>
        <div className="queues-section-heading">
          <div className="queues-section-heading-copy"><span className="queues-section-icon" aria-hidden="true">+</span><div><p className="eyebrow">NOVA FILA</p><h3>Criar uma rotina</h3><p>Defina o conteúdo, as redes e os dias em poucos passos.</p></div></div>
          <span className="queues-step-label">1–3</span>
        </div>

        <div className="queues-form-fields">
          <label className="queues-field"><span>Nome da fila</span><small>Um nome fácil de reconhecer depois.</small><input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ex.: Dicas da semana" required /></label>
          <label className="queues-field"><span>Texto da publicação</span><small>O conteúdo será reutilizado nas execuções da fila.</small><textarea value={form.text} onChange={event => setForm(current => ({ ...current, text: event.target.value }))} placeholder="Uma ideia que será publicada nos dias selecionados…" required /></label>
        </div>

        <fieldset className="queues-fieldset">
          <legend><span>Onde publicar?</span><small>{selectedPlatforms.length ? `${selectedPlatforms.length} selecionada(s)` : 'Selecione ao menos uma rede'}</small></legend>
          <div className="queues-platform-options">
            {platforms.map(([id, label]) => <label className={`queues-platform-option${form.platforms.includes(id) ? ' is-selected' : ''}`} key={id}>
              <input type="checkbox" checked={form.platforms.includes(id)} onChange={() => togglePlatform(id)} />
              <span className={`queues-platform-icon queues-platform-${id}`} aria-hidden="true">{platformIcon(id)}</span>
              <span className="queues-option-copy"><strong>{label}</strong><small>{id === 'instagram' ? 'Feed e reels' : id === 'facebook' ? 'Página e perfil' : id === 'youtube' ? 'Canal de vídeos' : 'Vídeos curtos'}</small></span>
              <span className="queues-option-check" aria-hidden="true">{form.platforms.includes(id) ? '✓' : '+'}</span>
            </label>)}
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
        <button className="action-button queues-submit-button" disabled={!form.platforms.length || !form.days.length}><span aria-hidden="true">+</span> Criar fila</button>
      </form>

      <section className="panel queues-list-panel">
        <header className="queues-list-heading">
          <div><p className="eyebrow">SUAS ROTINAS</p><h3>Filas configuradas</h3><p>Gerencie o que está ativo e acompanhe a próxima publicação.</p></div>
          <div className="queues-list-heading-actions"><span className="queues-count-badge">{queues.length} {queues.length === 1 ? 'fila' : 'filas'}</span><button type="button" className="queues-refresh-button" onClick={() => load().catch(error => notify(error.message, 'error'))} aria-label="Atualizar filas">↻</button></div>
        </header>
        {queues.length ? <div className="queues-list">{queues.map(queue => <article className={`queues-card${queue.active ? ' is-active' : ' is-paused'}`} key={queue.id}>
          <div className="queues-card-heading"><div className="queues-card-title"><span className="queues-card-icon" aria-hidden="true">↻</span><div><div className="queues-card-name-row"><strong>{queue.name}</strong><span className={`queues-status${queue.active ? ' is-active' : ' is-paused'}`}><i aria-hidden="true" />{queue.active ? 'Ativa' : 'Pausada'}</span></div><small>Criada para repetir automaticamente</small></div></div></div>
          <p className="queues-card-content">“{queue.content?.text || 'Conteúdo por plataforma'}”</p>
          <div className="queues-card-details">
            <div><span>HORÁRIO</span><strong>{queue.recurrence?.time || '10:00'}</strong><small>{formatQueueDays(queue)}</small></div>
            <div><span>PRÓXIMA PUBLICAÇÃO</span><strong>{formatNextRun(queue)}</strong><small>{queue.active ? 'Agendamento automático' : 'Ative para retomar'}</small></div>
            <div><span>REDES</span><div className="queues-card-platforms">{(queue.platforms || []).length ? queue.platforms.map(platform => <span className={`queues-card-platform queues-platform-${platform}`} key={platform} title={platform}>{platformIcon(platform)}</span>) : <small>Nenhuma rede</small>}</div></div>
          </div>
          <footer className="queues-card-actions"><button type="button" className={`queues-toggle-button${queue.active ? '' : ' is-resume'}`} onClick={() => toggle(queue)}><span aria-hidden="true">{queue.active ? 'Ⅱ' : '▶'}</span>{queue.active ? 'Pausar fila' : 'Ativar fila'}</button><button type="button" className="queues-delete-button" onClick={() => remove(queue)}><span aria-hidden="true">⌫</span> Excluir</button></footer>
        </article>)}</div> : <div className="queues-empty-state"><span className="queues-empty-icon" aria-hidden="true">↻</span><strong>Nenhuma fila criada ainda</strong><p>Monte sua primeira rotina ao lado e deixe o conteúdo pronto para voltar à agenda automaticamente.</p></div>}
      </section>
    </div>
  </section>
}
