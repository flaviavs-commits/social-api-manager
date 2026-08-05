import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { useToast } from '../components/ui/toast.jsx'

const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'

export function DraftsPage({ onNavigate }) {
  const [text, setText] = useState('')
  const load = useCallback(() => apiFetch('/api/drafts').then(data => data.drafts || []), [])
  const { value: drafts, loading, error, setError, reload } = useApiResource(load, [])
  const notify = useToast()

  async function save(event) {
    event.preventDefault()
    if (!text.trim()) return
    try { await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Rascunho', text, platforms: [] }) }); setText(''); await reload() }
    catch (e) { setError(e.message) }
  }

  async function remove(id) {
    if (!window.confirm('Excluir este rascunho?')) return
    try { await apiFetch(`/api/drafts/${id}`, { method: 'DELETE' }); await reload() }
    catch (e) { setError(e.message) }
  }

  function useDraft(draft) {
    const platforms = Array.isArray(draft.platforms) ? draft.platforms : []
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({ text: draft.text || '', selected: platforms.length ? platforms : ['instagram'], publishNow: false, date: '', firstComment: draft.first_comment || '', textByPlatform: draft.text_by_platform || {}, savedAt: new Date().toISOString() }))
    notify('Conteúdo carregado no editor.')
    onNavigate?.('agendador')
  }

  return <section className="page-view"><section className="panel">
    <p className="eyebrow">EDITOR</p><h2>Novo rascunho</h2>
    <form className="draft-form sched-form" onSubmit={save}>
      <SchedSection number={1} title="Conteúdo">
        <textarea value={text} onChange={event => setText(event.target.value)} placeholder="Escreva o conteúdo da publicação..." aria-label="Texto do rascunho"/>
      </SchedSection>
      <button className="action-button">Salvar rascunho</button>
    </form>
  </section>
  <section className="panel">
    <h2>Rascunhos salvos</h2>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading ? <LoadingState>Carregando rascunhos...</LoadingState> : drafts.length ? <div className="draft-list">{drafts.map(draft => { const template = Boolean(draft.is_template || draft.isTemplate); return <div className="data-row draft-row" key={draft.id}><span className="draft-row-copy"><strong>{draft.text || draft.title || 'Rascunho sem texto'}</strong><small>{template ? 'Modelo reutilizável' : 'Rascunho em andamento'}</small></span><span className="draft-row-actions"><button className="link-button" onClick={() => useDraft(draft)}>{template ? 'Usar modelo' : 'Continuar'}</button><button className="link-button danger-link" onClick={() => remove(draft.id)}>Excluir</button></span></div> })}</div> : <p className="empty-state">Nenhum rascunho salvo.</p>}
  </section></section>
}
