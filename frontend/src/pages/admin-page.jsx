import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api.js'
import { PLANS } from '../lib/plans.js'
import { useApiResource } from '../hooks/use-api-resource.js'
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
  ['historico', 'Histórico'],
  ['dashboard', 'Dashboard'],
]

const LOG_TYPE_LABELS = { err: 'Erro', ok: 'Sucesso', info: 'Informação' }

function tabFromLocation(search = window.location.search) {
  const tab = new URLSearchParams(search).get('tab')
  return TABS.some(([key]) => key === tab) ? tab : TABS[0][0]
}

// Resolve um e-mail para uma conta via GET /api/admin/users/search — não
// existe um diretório de clientes no painel (listUsers só devolve a própria
// conta do admin, por design: "O painel administrativo mostra somente a
// própria conta" em server.js). O admin já precisa saber o e-mail exato de
// quem procura (veio de um contato do cliente, ou do relatório de
// conciliação, que traz o e-mail real informado à Stripe).
function useUserSearch(initialEmail = '') {
  const [email, setEmail] = useState(initialEmail)
  const [user, setUser] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const search = useCallback(async searchEmail => {
    const target = (searchEmail ?? email).trim()
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiFetch(`/api/admin/users/search?email=${encodeURIComponent(target)}`)
      setUser(result.user)
    } catch (err) {
      setUser(null)
      setError(err instanceof ApiError ? err.message : 'Não foi possível buscar esse usuário.')
    } finally { setBusy(false) }
  }, [email])

  return { email, setEmail, user, setUser, busy, error, search }
}

// Ferramenta independente (não presa a uma linha de tabela, já que a tabela
// de usuários só lista a própria conta): busca um cliente pelo e-mail e gera
// o Payment Link do plano escolhido já com o client_reference_id dele, para
// o time mandar manualmente quando precisar (ex.: cliente que não conseguiu
// concluir pelo checkout dentro do app). Cada geração fica auditada no log
// do admin autor.
function GeneratePlanLinkTool({ onError }) {
  const lookup = useUserSearch()
  const [plan, setPlan] = useState(planOptions[0]?.id || '')
  const [state, setState] = useState({ busy: false, url: null, copied: false })

  const generate = async () => {
    if (!lookup.user) return onError('Busque o cliente pelo e-mail antes de gerar o link.')
    setState({ busy: true, url: null, copied: false })
    try {
      const result = await apiFetch(`/api/admin/users/${lookup.user.id}/plan-link/${plan}`)
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

  return <div className="admin-content"><div className="admin-section-heading"><h2>Gerar link de pagamento para um cliente</h2></div><div className="admin-reconciliation-controls"><input value={lookup.email} onChange={event => { lookup.setEmail(event.target.value); lookup.setUser(null) }} placeholder="E-mail do cliente" aria-label="E-mail do cliente para gerar link de pagamento" /><button type="button" onClick={() => lookup.search()} disabled={lookup.busy || !lookup.email.trim()}>{lookup.busy ? '…' : 'Buscar'}</button>{lookup.user && <><select value={plan} onChange={event => setPlan(event.target.value)} disabled={state.busy} aria-label={`Plano do link de pagamento para ${lookup.user.email}`}>{planOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><button type="button" onClick={generate} disabled={state.busy}>{state.busy ? '…' : 'Gerar link'}</button>{state.url && <button type="button" onClick={copy}>{state.copied ? 'Copiado!' : 'Copiar link'}</button>}</>}</div>{lookup.error && <p className="admin-notice admin-notice--error" role="alert">{lookup.error}</p>}{lookup.user && <p className="admin-user-found">Cliente encontrado: <strong>{lookup.user.fullName || lookup.user.email}</strong> ({lookup.user.email})</p>}</div>
}

// Vincula uma sessão paga (linha do relatório de conciliação) a uma conta e
// plano escolhidos pelo admin — a Stripe já confirmou o pagamento, então essa
// ação só resolve qual conta recebe o quê, sem tocar direto no banco. Busca
// automaticamente pelo e-mail que a Stripe informou (item.customerEmail),
// quando existir — o admin ainda pode trocar antes de confirmar.
function LinkPaymentAction({ item, onLinked, onError }) {
  const lookup = useUserSearch(item.customerEmail || '')
  const [plan, setPlan] = useState(item.suggestedPlan || planOptions[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const buscaAutomatica = useRef(false)

  useEffect(() => {
    if (buscaAutomatica.current || !item.customerEmail) return
    buscaAutomatica.current = true
    lookup.search(item.customerEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.customerEmail])

  const link = async () => {
    if (!lookup.user) return onError('Busque o cliente pelo e-mail antes de vincular.')
    setBusy(true)
    try {
      await apiFetch(`/api/admin/billing/reconciliation/${item.sessionId}/link`, {
        method: 'POST',
        body: JSON.stringify({ userId: lookup.user.id, plan }),
      })
      onLinked(item.sessionId)
    } catch (error) {
      onError(error instanceof ApiError ? error.message : 'Não foi possível vincular esse pagamento.')
    } finally { setBusy(false) }
  }

  return <div className="admin-plan-link"><input value={lookup.email} onChange={event => { lookup.setEmail(event.target.value); lookup.setUser(null) }} placeholder="E-mail do cliente" aria-label={`E-mail do cliente para vincular a sessão ${item.sessionId}`} /><button type="button" onClick={() => lookup.search()} disabled={lookup.busy || !lookup.email.trim()}>{lookup.busy ? '…' : 'Buscar'}</button><select value={plan} onChange={event => setPlan(event.target.value)} disabled={busy} aria-label={`Plano para vincular a sessão ${item.sessionId}`}>{planOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><button type="button" onClick={link} disabled={busy || !lookup.user}>{busy ? '…' : 'Vincular'}</button>{lookup.error && <span className="admin-inline-error">{lookup.error}</span>}{lookup.user && <span className="admin-user-found">{lookup.user.email}</span>}</div>
}

// Relatório de conciliação: cruza a Stripe com o banco e mostra os pagamentos
// confirmados sem cobrança correspondente. O alerta imediato por e-mail para
// todo admin já é disparado no backend (billingService.logUnlinkedPayment);
// esta seção é onde o admin resolve o que o alerta apontou.
function ReconciliationSection({ onError }) {
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

  return <section className="admin-content"><div className="admin-section-heading"><h2>Pagamentos não conciliados</h2><div className="admin-reconciliation-controls"><select value={days} onChange={event => setDays(Number(event.target.value))} disabled={loading}>{reconciliationDaysOptions.map(option => <option key={option} value={option}>Últimos {option} dias</option>)}</select><button type="button" onClick={load} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Data</th><th>Valor</th><th>E-mail do comprador</th><th>Referência</th><th>Plano sugerido</th><th>Vincular</th></tr></thead><tbody>{loading ? <tr><td colSpan="6" className="admin-empty">Carregando…</td></tr> : !report?.unmatched?.length ? <tr><td colSpan="6" className="admin-empty">Nenhum pagamento sem conciliação nos últimos {days} dias.</td></tr> : report.unmatched.map(item => <tr key={item.sessionId}><td>{new Date(item.createdAt).toLocaleString('pt-BR')}</td><td>{formatCurrency(item.amountCents)}</td><td>{item.customerEmail || '—'}</td><td>{item.clientReferenceId || '—'}</td><td>{item.suggestedPlan ? PLANS[item.suggestedPlan]?.name : '—'}</td><td><LinkPaymentAction item={item} onLinked={handleLinked} onError={onError} /></td></tr>)}</tbody></table></div>{report?.truncated && <p className="admin-notice admin-notice--error" role="status">A lista foi cortada em {report.checked} sessões — reduza o período para ver tudo.</p>}</section>
}

// A tabela mostra só a própria conta do admin (listUsers/listarTodos é
// intencionalmente restrito — ver comentário em useUserSearch). A ação de
// gerar link para um CLIENTE fica separada, como ferramenta de busca por
// e-mail, porque não existe cliente nenhum nesta tabela para "escolher".
function UsersSection({ currentUser, users, loading, updating, onError, onToggleRole, onToggleActive }) {
  return <>
    <section className="admin-content"><div className="admin-section-heading"><h2>Sua conta</h2>{currentUser && <span>{currentUser.email}</span>}</div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>E-mail</th><th>Nome</th><th>Papel</th><th>Situação</th><th>Contas</th><th>Ações</th></tr></thead><tbody>{loading ? <tr><td colSpan="6" className="admin-empty">Carregando…</td></tr> : users.length === 0 ? <tr><td colSpan="6" className="admin-empty">Nenhum usuário encontrado.</td></tr> : users.map(user => { const isMe = user.id === currentUser?.id; const isSuperAdmin = user.role === 'super_admin'; const roleBusy = updating === `role-${user.id}`; const activeBusy = updating === `ativo-${user.id}`; return <tr key={user.id}><td>{user.email}</td><td>{user.fullName || '—'}</td><td><span className={`admin-pill admin-pill--${user.role}`}>{roleLabels[user.role] || user.role}</span></td><td><span className={`admin-pill admin-pill--${user.ativo ? 'active' : 'inactive'}`}>{user.ativo ? 'Ativo' : 'Desativado'}</span></td><td>{user.totalContas}</td><td className="admin-actions"><button type="button" disabled={isSuperAdmin || currentUser?.role !== 'super_admin' || roleBusy} onClick={() => onToggleRole(user)}>{roleBusy ? '…' : user.role === 'admin' ? 'Tornar usuário' : 'Tornar admin'}</button><button type="button" disabled={isMe || activeBusy || (user.role !== 'user' && currentUser?.role !== 'super_admin')} onClick={() => onToggleActive(user)}>{activeBusy ? '…' : user.ativo ? 'Desativar' : 'Ativar'}</button></td></tr> })}</tbody></table></div></section>
    <GeneratePlanLinkTool onError={onError} />
  </>
}

function AdminTabs({ tab, onChange }) {
  return <nav className="admin-tabs" aria-label="Seções do painel admin">{TABS.map(([key, label]) => <button key={key} type="button" className={`admin-tab${tab === key ? ' is-active' : ''}`} aria-current={tab === key ? 'page' : undefined} onClick={() => onChange(key)}>{label}</button>)}</nav>
}

// Histórico de ações administrativas: reaproveita /api/logs, o mesmo
// endpoint já usado pela Central de Atividades do app principal
// (activity-page.jsx) — escopado ao próprio admin autenticado, preservando a
// garantia de que ninguém vê dado de outra conta fora dos dois pontos já
// auditados explicitamente (link de pagamento, vínculo manual). As ações de
// papel/situação passaram a gerar log em 10/09/2026 especificamente para
// esta seção não nascer vazia.
function HistorySection() {
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  const loadLogs = useCallback(() => apiFetch('/api/logs?limit=200').then(data => data.logs || []), [])
  const { value: logs, loading, error, reload } = useApiResource(loadLogs, [])

  const visibleLogs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return logs.filter(log => (type === 'all' || log.type === type) && (!query || String(log.message).toLowerCase().includes(query)))
  }, [logs, search, type])

  return <section className="admin-content"><div className="admin-section-heading"><h2>Histórico de ações administrativas</h2><div className="admin-reconciliation-controls"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar…" aria-label="Buscar no histórico" /><select value={type} onChange={event => setType(event.target.value)} aria-label="Filtrar tipo de atividade"><option value="all">Todos os tipos</option>{Object.entries(LOG_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="button" onClick={() => reload().catch(() => {})} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div></div>{error && <p className="admin-notice admin-notice--error" role="alert">{error}</p>}<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Quando</th><th>Tipo</th><th>Ação</th></tr></thead><tbody>{loading ? <tr><td colSpan="3" className="admin-empty">Carregando…</td></tr> : !visibleLogs.length ? <tr><td colSpan="3" className="admin-empty">{search || type !== 'all' ? 'Nenhuma ação corresponde aos filtros.' : 'Nenhuma ação administrativa registrada ainda.'}</td></tr> : visibleLogs.map(log => <tr key={log.id}><td>{log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : '—'}</td><td><span className={`admin-pill admin-pill--${log.type === 'err' ? 'inactive' : log.type === 'ok' ? 'active' : 'user'}`}>{LOG_TYPE_LABELS[log.type] || 'Atividade'}</span></td><td>{log.message}</td></tr>)}</tbody></table></div></section>
}

// Dashboard: GET /api/admin/dashboard devolve só contagens agregadas, sem
// nenhum dado individual (nome, e-mail, id) — exceção documentada e
// deliberada à política de "sem diretório global", decidida em 10/09/2026
// (Trilha B, pergunta feita explicitamente antes de implementar; ver IA.md e
// usersRepository.obterMetricasAgregadas).
function DashboardSection() {
  const loadMetrics = useCallback(() => apiFetch('/api/admin/dashboard'), [])
  const { value: metrics, loading, error, reload } = useApiResource(loadMetrics, null)

  const planEntries = metrics ? Object.entries(metrics.porPlano).sort(([, a], [, b]) => b - a) : []

  return <section className="admin-content"><div className="admin-section-heading"><h2>Dashboard</h2><div className="admin-reconciliation-controls"><button type="button" onClick={() => reload().catch(() => {})} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div></div>{error && <p className="admin-notice admin-notice--error" role="alert">{error}</p>}{loading ? <p className="admin-empty">Carregando…</p> : metrics && <div className="admin-stats"><div className="admin-stat-card"><strong>{metrics.totalUsuarios}</strong><span>Usuários no total</span></div><div className="admin-stat-card"><strong>{metrics.ativos}</strong><span>Contas ativas</span></div><div className="admin-stat-card"><strong>{metrics.desativados}</strong><span>Contas desativadas</span></div><div className="admin-stat-card admin-stat-card--warning"><strong>{metrics.pagamentosNaoConciliados}</strong><span>Pagamentos não conciliados (7 dias)</span></div>{planEntries.map(([plan, total]) => <div className="admin-stat-card" key={plan}><strong>{total}</strong><span>{PLANS[plan]?.name || plan}</span></div>)}</div>}</section>
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

  return <main className="admin-page"><header className="admin-header"><a className="admin-logo" href="/app/dashboard" aria-label="Meu Ecoo Mídia - ir para o dashboard"><img src="/logo.png" alt="Meu Ecoo Mídia" /></a><div><p className="admin-eyebrow">GESTÃO DO SISTEMA</p><h1>Administração</h1></div><a href="/app.html" className="admin-back">← Voltar ao painel</a></header><Notice notice={notice} /><AdminTabs tab={tab} onChange={changeTab} />{tab === 'usuarios' && <UsersSection currentUser={currentUser} users={users} loading={loading} updating={updating} onError={onError} onToggleRole={toggleRole} onToggleActive={toggleActive} />}{tab === 'conciliacao' && !loading && <ReconciliationSection onError={onError} />}{tab === 'historico' && <HistorySection />}{tab === 'dashboard' && <DashboardSection />}<footer className="admin-footer"><CopyrightNotice /></footer></main>
}
