import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'

export function DraftsPage() {
  const [text, setText] = useState('')
  const load = useCallback(() => apiFetch('/api/drafts').then(data => data.drafts || []), [])
  const { value: drafts, loading, error, setError, reload } = useApiResource(load, [])

  async function save(event) {
    event.preventDefault()
    if (!text.trim()) return
    try { await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Rascunho', text, platforms: [] }) }); setText(''); await reload() }
    catch (e) { setError(e.message) }
  }

  async function remove(id) {
    try { await apiFetch(`/api/drafts/${id}`, { method: 'DELETE' }); await reload() }
    catch (e) { setError(e.message) }
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
    {loading ? <p className="empty-state" aria-live="polite">Carregando rascunhos...</p> : drafts.length ? drafts.map(draft => <div className="data-row" key={draft.id}><span>{draft.text || draft.title}</span><button className="link-button" onClick={() => remove(draft.id)}>Excluir</button></div>) : <p className="empty-state">Nenhum rascunho salvo.</p>}
  </section></section>
}
