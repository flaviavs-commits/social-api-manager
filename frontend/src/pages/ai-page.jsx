import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'

export function AiPage() {
  const [instruction, setInstruction] = useState('')
  const [posts, setPosts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [activityLogs, setActivityLogs] = useState([])

  useEffect(() => {
    apiFetch('/api/ai/activity-log?limit=20')
      .then(data => setActivityLogs(data.logs || []))
      .catch(() => {})
  }, [])

  async function generate(event) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const data = await apiFetch('/api/ai/generate', { method: 'POST', body: JSON.stringify({ instrucao: instruction, plataformas: ['instagram'], quantidade: 3, tom: 'profissional' }) })
      setPosts((data.posts || []).map(post => ({ ...post, text: post.text || post.caption || '' })))
      setEditingIndex(null)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  return <section className="page-view ai-page"><section className="panel ai-generator-panel">
    <p className="eyebrow">ASSISTENTE</p><h2>Gerar ideias de posts</h2>
    <form className="draft-form sched-form" onSubmit={generate}>
      <SchedSection number={1} title="Instrução">
        <textarea value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Ex.: crie ideias sobre educação financeira" aria-label="Instrução para a IA"/>
      </SchedSection>
      <button className="action-button" disabled={loading}>{loading ? 'Gerando...' : 'Gerar posts'}</button>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>
  {posts.length > 0 && <section className="panel ai-suggestions-panel">
    <h2>Sugestões</h2>
    {posts.map((post, index) => <div className="data-row" key={post.id || index}>
      {editingIndex === index
        ? <textarea className="flex-1 rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={post.text} onChange={event => setPosts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} aria-label={`Editar sugestão ${index + 1}`} />
        : <span>{post.text}</span>}
      <button type="button" className="link-button" onClick={() => setEditingIndex(editingIndex === index ? null : index)}>{editingIndex === index ? 'Concluir edição' : 'Editar texto'}</button>
    </div>)}
  </section>}
  <section className="panel ai-logs-panel">
    <div className="panel-heading"><div><p className="eyebrow">DIAGNÓSTICO</p><h2>Logs do Agente IA</h2></div><button type="button" className="link-button" onClick={() => apiFetch('/api/ai/activity-log?limit=20').then(data => setActivityLogs(data.logs || []))}>Atualizar</button></div>
    {activityLogs.length ? activityLogs.map(log => <div className="data-row" key={log.id}><span><strong>{log.status}</strong> · {log.acao}{log.modelo ? ` · ${log.modelo}` : ''}<br /><small>{log.detalhes || 'Sem detalhes'} · {new Date(log.criadoEm).toLocaleString('pt-BR')}</small></span></div>) : <p className="empty-state">Nenhum registro do agente ainda.</p>}
  </section>
  </section>
}
