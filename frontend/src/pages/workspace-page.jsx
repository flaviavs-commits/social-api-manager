import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'

export function WorkspacePage() {
  const [workspaces, setWorkspaces] = useState([])
  const [posts, setPosts] = useState([])
  const [form, setForm] = useState({ name: '', email: '', postId: '', brandName: '', primaryColor: '#d9ad5b' })
  const [selected, setSelected] = useState(null)
  const [approvals, setApprovals] = useState([])
  const notify = useToast()

  const load = useCallback(async () => {
    const [spaces, postData] = await Promise.all([apiFetch('/api/workspaces'), apiFetch('/api/posts')])
    setWorkspaces(spaces.workspaces || [])
    setPosts(postData.posts || [])
    if (!selected && spaces.workspaces?.[0]) setSelected(spaces.workspaces[0])
  }, [selected])

  useEffect(() => { load().catch(error => notify(error.message, 'error')) }, [load, notify])
  useEffect(() => {
    if (selected) apiFetch(`/api/workspaces/${selected.id}/approvals`).then(data => setApprovals(data.approvals || [])).catch(() => {})
  }, [selected])

  async function createWorkspace(event) {
    event.preventDefault()
    try {
      await apiFetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: form.name }) })
      setForm(current => ({ ...current, name: '' }))
      await load()
      notify('Espaço criado.')
    } catch (error) { notify(error.message, 'error') }
  }

  async function invite(event) {
    event.preventDefault()
    if (!selected) return
    try {
      await apiFetch(`/api/workspaces/${selected.id}/members`, { method: 'POST', body: JSON.stringify({ email: form.email, role: 'editor' }) })
      setForm(current => ({ ...current, email: '' }))
      notify('Membro adicionado.')
    } catch (error) { notify(error.message, 'error') }
  }

  async function requestApproval(event) {
    event.preventDefault()
    if (!selected || !form.postId) return
    try {
      await apiFetch(`/api/workspaces/${selected.id}/approvals`, { method: 'POST', body: JSON.stringify({ postId: Number(form.postId) }) })
      const data = await apiFetch(`/api/workspaces/${selected.id}/approvals`)
      setApprovals(data.approvals || [])
      notify('Aprovação solicitada.')
    } catch (error) { notify(error.message, 'error') }
  }

  async function review(approval, status) {
    try {
      await apiFetch(`/api/workspaces/approvals/${approval.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setApprovals(current => current.map(item => item.id === approval.id ? { ...item, status } : item))
      notify(status === 'approved' ? 'Conteúdo aprovado.' : 'Conteúdo rejeitado.')
    } catch (error) { notify(error.message, 'error') }
  }

  async function saveBranding(event) {
    event.preventDefault()
    if (!selected) return
    try {
      await apiFetch(`/api/workspaces/${selected.id}/branding`, { method: 'PATCH', body: JSON.stringify({ name: form.brandName, primaryColor: form.primaryColor }) })
      notify('Identidade visual salva.')
    } catch (error) { notify(error.message, 'error') }
  }

  return <section className="page-view">
    <header className="panel-heading"><div><p className="eyebrow">OPERAÇÃO EM EQUIPE</p><h2>Espaços de trabalho</h2><p className="panel-subtitle">Organize clientes, convide colaboradores e aprove conteúdos com clareza.</p></div></header>
    <div className="grid gap-5 lg:grid-cols-2">
      <form className="panel space-y-3" onSubmit={createWorkspace}><p className="eyebrow">ESPAÇOS DE TRABALHO</p><h3 className="text-lg font-semibold text-zinc-100">Criar espaço</h3><input className="w-full rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Cliente ou marca" required/><button className="action-button">Criar espaço</button><div className="mt-4 space-y-2">{workspaces.map(space => <button type="button" className={`block w-full rounded-lg border p-3 text-left text-sm ${selected?.id === space.id ? 'border-gold bg-gold/10' : 'border-subtle'}`} key={space.id} onClick={() => setSelected(space)}><strong>{space.name}</strong><small className="ml-2 text-zinc-500">{space.role}</small></button>)}</div></form>
      <section className="panel"><p className="eyebrow">COLABORAÇÃO</p><h3 className="text-lg font-semibold text-zinc-100">Convidar e aprovar</h3>{selected ? <><form className="mt-3 flex gap-2" onSubmit={invite}><input className="min-w-0 flex-1 rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} placeholder="e-mail do membro" required/><button className="secondary-button">Adicionar</button></form><form className="mt-3 flex gap-2" onSubmit={requestApproval}><select className="min-w-0 flex-1 rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.postId} onChange={event => setForm(current => ({ ...current, postId: event.target.value }))}><option value="">Escolha uma publicação</option>{posts.slice(0, 30).map(post => <option key={post.id} value={post.id}>#{post.id} {post.text || 'Publicação'}</option>)}</select><button className="action-button">Solicitar aprovação</button></form><form className="mt-3 grid grid-cols-[1fr_auto] gap-2" onSubmit={saveBranding}><input className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.brandName} onChange={event => setForm(current => ({ ...current, brandName: event.target.value }))} placeholder="Nome da marca no white label"/><input className="h-10 w-12 rounded-lg border border-subtle bg-app bg-transparent p-1" type="color" value={form.primaryColor} onChange={event => setForm(current => ({ ...current, primaryColor: event.target.value }))} aria-label="Cor principal"/><button className="secondary-button col-span-2">Salvar identidade visual</button></form><div className="mt-4 space-y-2">{approvals.map(approval => <article className="rounded-lg border border-subtle bg-app p-3 text-sm" key={approval.id}><strong>Post #{approval.postId}</strong><span className="ml-2 text-zinc-500">{approval.status}</span>{approval.status === 'pending' && <div className="mt-2 flex gap-2"><button type="button" className="link-button" onClick={() => review(approval, 'approved')}>Aprovar</button><button type="button" className="link-button danger-link" onClick={() => review(approval, 'rejected')}>Rejeitar</button></div>}</article>)}</div></> : <p className="empty-state">Crie ou selecione um espaço para começar.</p>}</section>
    </div>
  </section>
}
