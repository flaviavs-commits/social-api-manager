import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api.js'
import { ThemeSelector } from '../components/ui/theme-selector.jsx'
import { CopyrightNotice } from '../components/ui/copyright-notice.jsx'

const roleLabels = { super_admin: 'Administrador principal', admin: 'Administrador', user: 'Usuário' }

function Notice({ notice }) {
  return <div className="admin-notice-area"><ThemeSelector />{notice ? <p className={`admin-notice admin-notice--${notice.type}`} role="alert">{notice.text}</p> : null}</div>
}

export function AdminPage() {
  const [currentUser, setCurrentUser] = useState(null)
  const [users, setUsers] = useState([])
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const [me, result] = await Promise.all([apiFetch('/api/me'), apiFetch('/api/admin/users')])
      setCurrentUser(me)
      setUsers(result.data || [])
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof ApiError ? error.message : 'Não foi possível carregar os usuários.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const update = async (id, action, payload, successMessage) => {
    setUpdating(`${action}-${id}`)
    try {
      await apiFetch(`/api/admin/users/${id}/${action}`, { method: 'POST', body: JSON.stringify(payload) })
      setNotice({ type: 'success', text: successMessage })
      await loadUsers()
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Não foi possível concluir a ação.' })
    } finally { setUpdating(null) }
  }

  const toggleRole = user => update(user.id, 'role', { role: user.role === 'admin' ? 'user' : 'admin' }, 'Papel atualizado.')
  const toggleActive = user => update(user.id, 'ativo', { ativo: !user.ativo }, 'Situação atualizada.')

  return <main className="admin-page"><header className="admin-header"><a className="admin-logo" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/logo.svg" alt="Meu Ecoo Mídia" /></a><div><p className="admin-eyebrow">GESTÃO DO SISTEMA</p><h1>Administração</h1></div><a href="/app.html" className="admin-back">← Voltar ao painel</a></header><section className="admin-content"><Notice notice={notice} /><div className="admin-section-heading"><h2>Usuários</h2>{currentUser && <span>{currentUser.email}</span>}</div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>E-mail</th><th>Nome</th><th>Papel</th><th>Situação</th><th>Contas</th><th>Ações</th></tr></thead><tbody>{loading ? <tr><td colSpan="6" className="admin-empty">Carregando…</td></tr> : users.length === 0 ? <tr><td colSpan="6" className="admin-empty">Nenhum usuário encontrado.</td></tr> : users.map(user => { const isMe = user.id === currentUser?.id; const isSuperAdmin = user.role === 'super_admin'; const roleBusy = updating === `role-${user.id}`; const activeBusy = updating === `ativo-${user.id}`; return <tr key={user.id}><td>{user.email}</td><td>{user.fullName || '—'}</td><td><span className={`admin-pill admin-pill--${user.role}`}>{roleLabels[user.role] || user.role}</span></td><td><span className={`admin-pill admin-pill--${user.ativo ? 'active' : 'inactive'}`}>{user.ativo ? 'Ativo' : 'Desativado'}</span></td><td>{user.totalContas}</td><td className="admin-actions"><button type="button" disabled={isSuperAdmin || currentUser?.role !== 'super_admin' || roleBusy} onClick={() => toggleRole(user)}>{roleBusy ? '…' : user.role === 'admin' ? 'Tornar usuário' : 'Tornar admin'}</button><button type="button" disabled={isMe || activeBusy || (user.role !== 'user' && currentUser?.role !== 'super_admin')} onClick={() => toggleActive(user)}>{activeBusy ? '…' : user.ativo ? 'Desativar' : 'Ativar'}</button></td></tr> })}</tbody></table></div></section><footer className="admin-footer"><CopyrightNotice /></footer></main>
}
