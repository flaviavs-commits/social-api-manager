import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api.js'
import { PLANS } from '../lib/plans.js'
import { ThemeSelector } from '../components/ui/theme-selector.jsx'
import { CopyrightNotice } from '../components/ui/copyright-notice.jsx'

const roleLabels = { admin: 'Administrador', user: 'Usuário' }
const planOptions = Object.values(PLANS)
const reconciliationDaysOptions = [7, 15, 30]

// Mesmo formatador de profile-page.jsx (não exportado de lá para não acoplar
// as duas páginas por um utilitário de 1 linha).
function formatCurrency(amountCents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amountCents || 0) / 100)
}

function Notice({ notice }) {
  return <div className="admin-notice-area"><ThemeSelector />{notice ? <p className={`admin-notice admin-notice--${notice.type}`} role="alert">{notice.text}</p> : null}</div>
}

// Abas do painel — cada entrega desta reformulação (10/09/2026, decisão
// registrada no IA.md) adiciona uma aba nova: usuários e conciliação já
// existiam antes desta entrega; histórico e dashboard chegam nas próximas.
const TABS = [
  ['usuarios', 'Usuários'],
  ['conciliacao', 'Conciliação'],
]

function tabFromLocation(search = window.location.search) {
  const tab = new URLSearchParams(search).get('tab')
  return TABS.some(([key]) => key === tab) ? tab : TABS[0][0]
}

// Gera o Payment Link do plano escolhido já com o client_reference_id do
// usuário desta linha, para o time mandar manualmente quando precisar (ex.:
// cliente que não conseguiu concluir pelo checkout dentro do app). Fica só
// nesta ação porque é o único ponto do painel admin em que um admin acessa
// algo de outra conta — cada geração é registrada no log do admin autor.
function PlanLinkAction({ user, onError }) {
  const [plan, setPlan] = useState(planOptions[0]?.id || '')
  const [state, setState] = useState({ busy: false, url: null, copied: false })

  const generate = async () => {
    setState({ busy: true, url: null, copied: false })
    try {
      const result = await apiFetch(`/api/admin/users/${user.id}/plan-link/${plan}`)
      setState({ busy: false, url: result.url, copied: false })
    } catch (error) {
      setState({ busy: false, url: null, copied: false })
      onError(error instanceof ApiError ? error.message : 'Não foi possível gerar o link.')
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(state.url); setState(current => ({ ...current, copied: true })) }
    catch { onError('Não foi possível copiar o link — copie manualmente.') }
  }

  return <div className="admin-plan-link"><select value={plan} onChange={event => setPlan(event.target.value)} disabled={state.busy} aria-label={`Plano do link de pagamento para ${user.email}`}>{planOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><button type="button" onClick={generate} disabled={state.busy || !plan}>{state.busy ? '…' : 'Gerar link'}</button>{state.url && <button type="button" onClick={copy}>{state.copied ? 'Copiado!' : 'Copiar link'}</button>}</div>
}

// Vincula uma sessão paga (linha do relatório de conciliação) a uma conta e
// plano escolhidos pelo admin — a Stripe já confirmou o pagamento, então essa
// ação só resolve qual conta recebe o quê, sem tocar direto no banco.
function LinkPaymentAction({ item, users, onLinked, onError }) {
  const [userId, setUserId] = useState(item.suggestedUserId ? String(item.suggestedUserId) : '')
  const [plan, setPlan] = useState(item.suggestedPlan || planOptions[0]?.id || '')
  const [busy, setBusy] = useState(false)

  const link = async () => {
    if (!userId) return onError('Escolha para qual usuário vincular.')
    setBusy(true)
    try {
      await apiFetch(`/api/admin/billing/reconciliation/${item.sessionId}/link`, {
        method: 'POST',
        body: JSON.stringify({ userId: Number(userId), plan }),
      })
      onLinked(item.sessionId)
    } catch (error) {
      onError(error instanceof ApiError ? error.message : 'Não foi possível vincular esse pagamento.')
    } finally { setBusy(false) }
  }

  return <div className="admin-plan-link"><select value={userId} onChange={event => setUserId(event.target.value)} disabled={busy} aria-label={`Usuário para vincular a sessão ${item.sessionId}`}><option value="">Escolher usuário…</option>{users.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select><select value={plan} onChange={event => setPlan(event.target.value)} disabled={busy} aria-label={`Plano para vincular a sessão ${item.sessionId}`}>{planOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><button type="button" onClick={link} disabled={busy || !userId}>{busy ? '…' : 'Vincular'}</button></div>
}

// Relatório de conciliação: cruza a Stripe com o banco e mostra os pagamentos
// confirmados sem cobrança correspondente. O alerta imediato por e-mail para
// todo admin já é disparado no backend (billingService.logUnlinkedPayment);
// esta seção é onde o admin resolve o que o alerta apontou.
function ReconciliationSection({ users, onError }) {
  const [days, setDays] = useState(7)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setReport(await apiFetch(`/api/admin/billing/reconciliation?days=${days}`)) }
    catch (error) { onError(error instanceof ApiError ? error.message : 'Não foi possível carregar a conciliação.') }
    finally { setLoading(false) }
  }, [days])

  useEffect(() => { load() }, [load])

  const handleLinked = sessionId => {
    setReport(current => current ? { ...current, unmatched: current.unmatched.filter(item => item.sessionId !== sessionId) } : current)
  }

  return <section className="admin-content"><div className="admin-section-heading"><h2>Pagamentos não conciliados</h2><div className="admin-reconciliation-controls"><select value={days} onChange={event => setDays(Number(event.target.value))} disabled={loading}>{reconciliationDaysOptions.map(option => <option key={option} value={option}>Últimos {option} dias</option>)}</select><button type="button" onClick={load} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Data</th><th>Valor</th><th>E-mail do comprador</th><th>Referência</th><th>Plano sugerido</th><th>Vincular</th></tr></thead><tbody>{loading ? <tr><td colSpan="6" className="admin-empty">Carregando…</td></tr> : !report?.unmatched?.length ? <tr><td colSpan="6" className="admin-empty">Nenhum pagamento sem conciliação nos últimos {days} dias.</td></tr> : report.unmatched.map(item => <tr key={item.sessionId}><td>{new Date(item.createdAt).toLocaleString('pt-BR')}</td><td>{formatCurrency(item.amountCents)}</td><td>{item.customerEmail || '—'}</td><td>{item.clientReferenceId || '—'}</td><td>{item.suggestedPlan ? PLANS[item.suggestedPlan]?.name : '—'}</td><td><LinkPaymentAction item={item} users={users} onLinked={handleLinked} onError={onError} /></td></tr>)}</tbody></table></div>{report?.truncated && <p className="admin-notice admin-notice--error" role="status">A lista foi cortada em {report.checked} sessões — reduza o período para ver tudo.</p>}</section>
}

function UsersSection({ currentUser, users, loading, updating, onError, onToggleRole, onToggleActive }) {
  return <section className="admin-content"><div className="admin-section-heading"><h2>Usuários</h2>{currentUser && <span>{currentUser.email}</span>}</div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>E-mail</th><th>Nome</th><th>Papel</th><th>Situação</th><th>Contas</th><th>Link de pagamento</th><th>Ações</th></tr></thead><tbody>{loading ? <tr><td colSpan="7" className="admin-empty">Carregando…</td></tr> : users.length === 0 ? <tr><td colSpan="7" className="admin-empty">Nenhum usuário encontrado.</td></tr> : users.map(user => { const isMe = user.id === currentUser?.id; const isSuperAdmin = user.role === 'super_admin'; const roleBusy = updating === `role-${user.id}`; const activeBusy = updating === `ativo-${user.id}`; return <tr key={user.id}><td>{user.email}</td><td>{user.fullName || '—'}</td><td><span className={`admin-pill admin-pill--${user.role}`}>{roleLabels[user.role] || user.role}</span></td><td><span className={`admin-pill admin-pill--${user.ativo ? 'active' : 'inactive'}`}>{user.ativo ? 'Ativo' : 'Desativado'}</span></td><td>{user.totalContas}</td><td><PlanLinkAction user={user} onError={onError} /></td><td className="admin-actions"><button type="button" disabled={isSuperAdmin || currentUser?.role !== 'super_admin' || roleBusy} onClick={() => onToggleRole(user)}>{roleBusy ? '…' : user.role === 'admin' ? 'Tornar usuário' : 'Tornar admin'}</button><button type="button" disabled={isMe || activeBusy || (user.role !== 'user' && currentUser?.role !== 'super_admin')} onClick={() => onToggleActive(user)}>{activeBusy ? '…' : user.ativo ? 'Desativar' : 'Ativar'}</button></td></tr> })}</tbody></table></div></section>
}

function AdminTabs({ tab, onChange }) {
  return <nav className="admin-tabs" aria-label="Seções do painel admin">{TABS.map(([key, label]) => <button key={key} type="button" className={`admin-tab${tab === key ? ' is-active' : ''}`} aria-current={tab === key ? 'page' : undefined} onClick={() => onChange(key)}>{label}</button>)}</nav>
}

export function AdminPage() {
  const [currentUser, setCurrentUser] = useState(null)
  const [users, setUsers] = useState([])
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [tab, setTab] = useState(() => tabFromLocation())

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

  useEffect(() => {
    const onPopState = () => setTab(tabFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const changeTab = nextTab => {
    if (nextTab === tab) return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', nextTab)
    window.history.pushState({}, '', url)
    setTab(nextTab)
  }

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
  const onError = text => setNotice({ type: 'error', text })

  return <main className="admin-page"><header className="admin-header"><a className="admin-logo" href="/app/dashboard" aria-label="Meu Ecoo Mídia - ir para o dashboard"><img src="/logo.png" alt="Meu Ecoo Mídia" /></a><div><p className="admin-eyebrow">GESTÃO DO SISTEMA</p><h1>Administração</h1></div><a href="/app.html" className="admin-back">← Voltar ao painel</a></header><Notice notice={notice} /><AdminTabs tab={tab} onChange={changeTab} />{tab === 'usuarios' && <UsersSection currentUser={currentUser} users={users} loading={loading} updating={updating} onError={onError} onToggleRole={toggleRole} onToggleActive={toggleActive} />}{tab === 'conciliacao' && !loading && <ReconciliationSection users={users} onError={onError} />}<footer className="admin-footer"><CopyrightNotice /></footer></main>
}
