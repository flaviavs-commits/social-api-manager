import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'
import '../styles/workspace-page.css'

const roleLabels = {
  owner: 'Proprietário',
  admin: 'Administrador',
  editor: 'Editor',
  reviewer: 'Aprovador',
}

const approvalLabels = {
  pending: 'Aguardando aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
}

function initials(member) {
  const source = member.fullName || member.email || '?'
  return source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function formatDate(value) {
  if (!value) return 'agora'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'agora' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function WorkspacePage() {
  const [workspaces, setWorkspaces] = useState([])
  const [posts, setPosts] = useState([])
  const [members, setMembers] = useState([])
  const [form, setForm] = useState({ name: '', email: '', role: 'editor', postId: '', brandName: '', primaryColor: '#d9ad5b' })
  const [selected, setSelected] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const notify = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [spaces, postData] = await Promise.all([apiFetch('/api/workspaces'), apiFetch('/api/posts')])
      const nextSpaces = spaces.workspaces || []
      setWorkspaces(nextSpaces)
      setPosts(postData.posts || [])
      setSelected(current => nextSpaces.find(space => space.id === current?.id) || nextSpaces[0] || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load().catch(error => notify(error.message, 'error')) }, [load, notify])

  useEffect(() => {
    if (!selected) {
      setMembers([])
      setApprovals([])
      return undefined
    }
    let active = true
    setLoadingDetails(true)
    Promise.all([
      apiFetch(`/api/workspaces/${selected.id}/members`),
      apiFetch(`/api/workspaces/${selected.id}/approvals`),
    ]).then(([memberData, approvalData]) => {
      if (!active) return
      setMembers(memberData.members || [])
      setApprovals(approvalData.approvals || [])
      setForm(current => ({
        ...current,
        brandName: selected.branding?.name || '',
        primaryColor: selected.branding?.primaryColor || '#d9ad5b',
      }))
    }).catch(error => {
      if (active) notify(error.message, 'error')
    }).finally(() => {
      if (active) setLoadingDetails(false)
    })
    return () => { active = false }
  }, [selected, notify])

  async function createWorkspace(event) {
    event.preventDefault()
    try {
      await apiFetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: form.name }) })
      setForm(current => ({ ...current, name: '' }))
      await load()
      notify('Espaço criado. Agora você pode conectar contas e adicionar o time.')
    } catch (error) { notify(error.message, 'error') }
  }

  async function addMember(event) {
    event.preventDefault()
    if (!selected) return
    try {
      await apiFetch(`/api/workspaces/${selected.id}/members`, { method: 'POST', body: JSON.stringify({ email: form.email, role: form.role }) })
      const data = await apiFetch(`/api/workspaces/${selected.id}/members`)
      setMembers(data.members || [])
      setForm(current => ({ ...current, email: '' }))
      notify('Colaborador adicionado ao espaço.')
    } catch (error) { notify(error.message, 'error') }
  }

  async function requestApproval(event) {
    event.preventDefault()
    if (!selected || !form.postId) return
    try {
      await apiFetch(`/api/workspaces/${selected.id}/approvals`, { method: 'POST', body: JSON.stringify({ postId: Number(form.postId) }) })
      const data = await apiFetch(`/api/workspaces/${selected.id}/approvals`)
      setApprovals(data.approvals || [])
      setForm(current => ({ ...current, postId: '' }))
      notify('Solicitação enviada para aprovação.')
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
      const data = await apiFetch(`/api/workspaces/${selected.id}/branding`, { method: 'PATCH', body: JSON.stringify({ name: form.brandName, primaryColor: form.primaryColor }) })
      setSelected(current => current ? { ...current, branding: data.branding } : current)
      setWorkspaces(current => current.map(space => space.id === selected.id ? { ...space, branding: data.branding } : space))
      notify('Identidade visual atualizada.')
    } catch (error) { notify(error.message, 'error') }
  }

  const pendingApprovals = approvals.filter(approval => approval.status === 'pending').length
  const canManage = ['owner', 'admin'].includes(selected?.role)
  const selectedPost = posts.find(post => String(post.id) === String(form.postId))

  return <section className="page-view workspace-page">
    <header className="workspace-hero">
      <div className="workspace-hero-copy">
        <div className="workspace-hero-icon" aria-hidden="true">♟</div>
        <div>
          <p className="eyebrow">OPERAÇÃO EM EQUIPE</p>
          <h2>Trabalhe junto, com tudo organizado</h2>
          <p>Crie um espaço por cliente ou marca, convide as pessoas certas e mantenha cada publicação no fluxo de revisão.</p>
        </div>
      </div>
      {selected && <div className="workspace-current-badge"><span>Espaço ativo</span><strong>{selected.name}</strong></div>}
    </header>

    <section className="workspace-how-it-works" aria-labelledby="workspace-how-title">
      <div className="workspace-section-heading">
        <div><p className="eyebrow">COMO FUNCIONA</p><h3 id="workspace-how-title">Um espaço para cada operação</h3></div>
        <p>Você continua criando e agendando normalmente. A equipe entra para colaborar e revisar.</p>
      </div>
      <div className="workspace-steps">
        <article><span>1</span><div><strong>Organize</strong><p>Crie um espaço para cada cliente, marca ou projeto.</p></div></article>
        <article><span>2</span><div><strong>Colabore</strong><p>Adicione pessoas já cadastradas e defina o papel de cada uma.</p></div></article>
        <article><span>3</span><div><strong>Publique com segurança</strong><p>Envie posts para aprovação antes de publicar nas redes conectadas.</p></div></article>
      </div>
    </section>

    <div className="workspace-layout">
      <aside className="workspace-sidebar">
        <div className="workspace-panel-heading"><div><p className="eyebrow">SEUS ESPAÇOS</p><h3>Clientes e marcas</h3></div><span className="workspace-count">{workspaces.length}</span></div>
        <form className="workspace-create-form" onSubmit={createWorkspace}>
          <label htmlFor="workspace-name">Novo espaço</label>
          <div className="workspace-inline-form"><input id="workspace-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ex.: Loja Aurora" required/><button className="action-button" type="submit" aria-label="Criar novo espaço">+</button></div>
          <small>Use o nome do cliente ou da marca.</small>
        </form>
        {loading ? <div className="workspace-list-placeholder">Carregando espaços...</div> : workspaces.length ? <div className="workspace-list" role="listbox" aria-label="Espaços de trabalho">{workspaces.map(space => <button type="button" role="option" aria-selected={selected?.id === space.id} className={`workspace-list-item ${selected?.id === space.id ? 'is-selected' : ''}`} key={space.id} onClick={() => setSelected(space)}><span className="workspace-list-avatar">{space.name.slice(0, 1).toUpperCase()}</span><span className="workspace-list-copy"><strong>{space.name}</strong><small>{roleLabels[space.role] || space.role}</small></span><span className="workspace-list-arrow" aria-hidden="true">›</span></button>)}</div> : <div className="workspace-empty-list"><span aria-hidden="true">＋</span><strong>Comece por aqui</strong><p>Crie o primeiro espaço para organizar uma marca.</p></div>}
      </aside>

      <div className="workspace-main">
        {!selected ? <section className="workspace-empty-main"><div className="workspace-empty-main-icon" aria-hidden="true">✦</div><h3>Seu primeiro espaço começa aqui</h3><p>Crie um espaço ao lado para centralizar pessoas, aprovações e identidade visual de uma marca.</p></section> : <>
          <section className="workspace-overview-card">
            <div><p className="eyebrow">ESPAÇO SELECIONADO</p><h3>{selected.name}</h3><p>Você está trabalhando como <strong>{roleLabels[selected.role] || selected.role}</strong>. As ações abaixo ficam vinculadas a este espaço.</p></div>
            <div className="workspace-overview-stats"><div><strong>{members.length}</strong><span>pessoas</span></div><div><strong>{pendingApprovals}</strong><span>pendentes</span></div><div><strong>{approvals.length}</strong><span>solicitações</span></div></div>
          </section>

          <div className="workspace-content-grid">
            <section className="workspace-card workspace-members-card">
              <div className="workspace-card-heading"><div><p className="eyebrow">PESSOAS</p><h3>Quem trabalha aqui</h3><p>Adicione colaboradores que já possuem uma conta no Meu Ecoo Mídia.</p></div><span className="workspace-card-icon" aria-hidden="true">♙</span></div>
              {canManage && <form className="workspace-member-form" onSubmit={addMember}><label htmlFor="member-email">Adicionar colaborador</label><div className="workspace-member-fields"><input id="member-email" type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} placeholder="email@exemplo.com" required/><select value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value }))} aria-label="Papel do colaborador"><option value="editor">Editor</option><option value="reviewer">Aprovador</option><option value="admin">Administrador</option></select><button className="secondary-button" type="submit">Adicionar</button></div><small>O colaborador precisa criar uma conta antes de ser adicionado.</small></form>}
              <div className="workspace-member-list">{loadingDetails ? <p className="workspace-muted">Carregando pessoas...</p> : members.length ? members.map(member => <div className="workspace-member-row" key={member.id}><span className="workspace-member-avatar">{initials(member)}</span><div><strong>{member.fullName || member.email}</strong><small>{member.fullName ? member.email : 'Membro do espaço'}</small></div><span className="workspace-role-badge">{roleLabels[member.role] || member.role}</span></div>) : <p className="workspace-muted">Ainda não há outras pessoas neste espaço.</p>}</div>
            </section>

            <section className="workspace-card workspace-approval-card">
              <div className="workspace-card-heading"><div><p className="eyebrow">FLUXO DE APROVAÇÃO</p><h3>Revisar antes de publicar</h3><p>Peça uma revisão para manter o cliente alinhado antes do envio.</p></div><span className="workspace-card-icon" aria-hidden="true">✓</span></div>
              <div className="workspace-review-guide"><span className="workspace-review-guide-icon" aria-hidden="true">1</span><div><strong>Escolha o conteúdo que precisa ser revisado</strong><p>O responsável poderá aprovar ou rejeitar a publicação antes do envio para as redes.</p></div></div>
              <form className="workspace-approval-form" onSubmit={requestApproval}><label htmlFor="approval-post">Publicação para revisão</label><div className="workspace-approval-fields"><select id="approval-post" value={form.postId} onChange={event => setForm(current => ({ ...current, postId: event.target.value }))} required disabled={!posts.length}><option value="">{posts.length ? 'Selecione uma publicação...' : 'Você ainda não tem publicações'}</option>{posts.slice(0, 30).map(post => <option key={post.id} value={post.id}>#{post.id} · {(post.text || 'Publicação').slice(0, 54)}</option>)}</select><button className="action-button workspace-review-button" type="submit" disabled={!form.postId || !posts.length}><span aria-hidden="true">↗</span> Enviar para revisão</button></div><small>{posts.length ? 'A publicação ficará aguardando a decisão do responsável.' : 'Crie uma publicação no Criador de Posts para poder enviá-la para revisão.'}</small></form>
              {selectedPost && <div className="workspace-selected-post"><span className="workspace-selected-post-check" aria-hidden="true">✓</span><div><span>Selecionado para revisão</span><strong>Post #{selectedPost.id}</strong><p>{selectedPost.text || 'Publicação sem texto'}</p></div></div>}
              <div className="workspace-approval-list">{loadingDetails ? <p className="workspace-muted">Carregando solicitações...</p> : approvals.length ? approvals.slice(0, 5).map(approval => <article className="workspace-approval-row" key={approval.id}><div><strong>Post #{approval.postId}</strong><small>{formatDate(approval.createdAt)} · {approval.text ? approval.text.slice(0, 58) : 'Publicação sem texto'}</small></div><div className="workspace-approval-actions"><span className={`workspace-status workspace-status-${approval.status}`}>{approvalLabels[approval.status] || approval.status}</span>{approval.status === 'pending' && <div><button type="button" className="link-button" onClick={() => review(approval, 'approved')}>Aprovar</button><button type="button" className="link-button danger-link" onClick={() => review(approval, 'rejected')}>Rejeitar</button></div>}</div></article>) : <p className="workspace-muted">Nenhuma solicitação de aprovação por aqui.</p>}</div>
            </section>
          </div>

          <section className="workspace-card workspace-branding-card">
            <div className="workspace-card-heading"><div><p className="eyebrow">IDENTIDADE VISUAL</p><h3>Deixe o espaço com a cara da marca</h3><p>Esse nome e essa cor ajudam a identificar o cliente na operação e em experiências de marca.</p></div><span className="workspace-brand-preview" style={{ background: form.primaryColor }} aria-hidden="true" /></div>
            <form className="workspace-branding-form" onSubmit={saveBranding}><label><span>Nome exibido</span><input value={form.brandName} onChange={event => setForm(current => ({ ...current, brandName: event.target.value }))} placeholder={selected.name}/></label><label className="workspace-color-field"><span>Cor de destaque</span><input type="color" value={form.primaryColor} onChange={event => setForm(current => ({ ...current, primaryColor: event.target.value }))} aria-label="Cor de destaque do espaço"/></label><button className="secondary-button" type="submit" disabled={!canManage}>Salvar identidade visual</button></form>
          </section>
        </>}
      </div>
    </div>
  </section>
}
