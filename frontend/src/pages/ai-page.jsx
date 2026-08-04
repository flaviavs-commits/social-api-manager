import { useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'

export function AiPage() {
  const [instruction, setInstruction] = useState('')
  const [posts, setPosts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function generate(event) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const data = await apiFetch('/api/ai/generate', { method: 'POST', body: JSON.stringify({ instrucao: instruction, plataformas: ['instagram'], quantidade: 3, tom: 'profissional' }) })
      setPosts(data.posts || [])
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  return <section className="page-view"><section className="panel">
    <p className="eyebrow">ASSISTENTE</p><h2>Gerar ideias de posts</h2>
    <form className="draft-form sched-form" onSubmit={generate}>
      <SchedSection number={1} title="Instrução">
        <textarea value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Ex.: crie ideias sobre educação financeira" aria-label="Instrução para a IA"/>
      </SchedSection>
      <button className="action-button" disabled={loading}>{loading ? 'Gerando...' : 'Gerar posts'}</button>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>
  {posts.length > 0 && <section className="panel">
    <h2>Sugestões</h2>
    {posts.map((post, index) => <div className="data-row" key={post.id || index}><span>{post.text || post.caption || JSON.stringify(post)}</span></div>)}
  </section>}</section>
}
