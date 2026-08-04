import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'

export function DraftsPage() {
  const [drafts, setDrafts] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => { setLoading(true); return apiFetch('/api/drafts').then(data => setDrafts(data.drafts || [])).catch(e => setError(e.message)).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  async function save(event) {
    event.preventDefault()
    if (!text.trim()) return
    try { await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Rascunho', text, platforms: [] }) }); setText(''); load() }
    catch (e) { setError(e.message) }
  }

  async function remove(id) {
    try { await apiFetch(`/api/drafts/${id}`, { method: 'DELETE' }); load() }
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
