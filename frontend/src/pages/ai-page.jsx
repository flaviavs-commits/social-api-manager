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

  return <section className="page-view ai-page"><header className="ai-page-intro"><div><p className="eyebrow">ASSISTENTE IA</p><h2>Crie conteúdo com mais agilidade</h2><p>Descreva o que você quer publicar e receba ideias prontas para revisar, adaptar e usar nas suas redes.</p></div><span className="ai-page-intro-badge"><span aria-hidden="true">✦</span> Seu copiloto de conteúdo</span></header><section className="panel ai-generator-panel">
    <div className="ai-generator-heading"><div><p className="eyebrow">CRIAR CONTEÚDO</p><h2>O que você quer publicar?</h2><p>Quanto mais contexto você informar, mais úteis serão as sugestões.</p></div><span className="ai-generator-icon" aria-hidden="true">✦</span></div>
    <form className="draft-form sched-form" onSubmit={generate}>
      <SchedSection number={1} title="Instrução">
        <textarea className="ai-prompt-input" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Ex.: crie 3 ideias sobre educação financeira para jovens adultos" aria-label="Instrução para a IA"/><span className="ai-prompt-help">Inclua tema, público, objetivo, tom de voz ou rede social.</span>
      </SchedSection>
      <button className="action-button ai-generate-button" disabled={loading}>{loading ? 'Gerando ideias...' : 'Gerar ideias'}</button>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>
  {posts.length > 0 && <section className="panel ai-suggestions-panel">
    <div className="ai-panel-heading"><div><p className="eyebrow">RESULTADOS</p><h2>Sugestões para você</h2><p>Revise o texto e escolha a ideia que melhor combina com sua estratégia.</p></div><span className="ai-result-count">{posts.length} ideias</span></div>
    <div className="ai-suggestion-list">{posts.map((post, index) => <article className="ai-suggestion-card" key={post.id || index}><span className="ai-suggestion-number">{String(index + 1).padStart(2, '0')}</span><div className="ai-suggestion-body">
      {editingIndex === index
        ? <textarea className="ai-suggestion-editor" value={post.text} onChange={event => setPosts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} aria-label={`Editar sugestão ${index + 1}`} />
        : <p>{post.text}</p>}
      <button type="button" className="ai-edit-button link-button" onClick={() => setEditingIndex(editingIndex === index ? null : index)}>{editingIndex === index ? 'Concluir edição' : 'Editar texto'}</button>
    </div></article>)}</div>
  </section>}
  <section className="panel ai-logs-panel">
    <div className="ai-panel-heading"><div><p className="eyebrow">DIAGNÓSTICO</p><h2>Atividade do agente</h2><p>Acompanhe as últimas execuções realizadas pelo Assistente IA.</p></div><button type="button" className="ai-refresh-button link-button" onClick={() => apiFetch('/api/ai/activity-log?limit=20').then(data => setActivityLogs(data.logs || []))}>Atualizar</button></div>
    {activityLogs.length ? <div className="ai-log-list">{activityLogs.map(log => <div className="ai-log-row" key={log.id}><span className={`ai-log-status ai-log-status-${log.status === 'success' || log.status === 'ok' ? 'ok' : 'info'}`} aria-hidden="true">{log.status === 'success' || log.status === 'ok' ? '✓' : '·'}</span><div><strong>{log.acao}{log.modelo ? ` · ${log.modelo}` : ''}</strong><small>{log.detalhes || 'Sem detalhes'} · {new Date(log.criadoEm).toLocaleString('pt-BR')}</small></div><span className="ai-log-status-label">{log.status}</span></div>)}</div> : <p className="empty-state">Nenhum registro do agente ainda.</p>}
  </section>
  </section>
}
