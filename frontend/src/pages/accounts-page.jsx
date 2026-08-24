import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useToast } from '../components/ui/toast.jsx'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { getPlan } from '../lib/plans.js'

const providers = [
  { platform: 'facebook', provider: 'meta', label: 'Facebook', description: 'Páginas do Facebook' },
  { platform: 'instagram', provider: 'instagram', label: 'Instagram', description: 'Contas profissionais' },
  { platform: 'youtube', provider: 'google', label: 'YouTube', description: 'Canais de vídeo' },
  { platform: 'tiktok', provider: 'tiktok', label: 'TikTok', description: 'Contas de criador' },
]

const TOKEN_STATUS_LABELS = { valid: 'Token válido', expiring: 'Token expirando', expired: 'Token expirado', error: 'Erro no token' }
const HEALTH_LABELS = { up: 'API operacional', down: 'API indisponível', unknown: 'Saúde não verificada' }

function accountTokenStatus(account) {
  const statuses = (account.tokens || []).map(token => token.status).filter(Boolean)
  if (statuses.includes('expired') || statuses.includes('error')) return 'error'
  if (statuses.includes('expiring')) return 'expiring'
  return statuses.length ? 'valid' : 'missing'
}

function tokenExpiryText(account) {
  const expiry = (account.tokens || []).map(token => token.expiresAt).find(Boolean)
  if (!expiry) return ''
  const date = new Date(expiry)
  return Number.isNaN(date.getTime()) ? '' : `até ${date.toLocaleDateString('pt-BR')}`
}

function accountProfileUrl(account) {
  const value = account.profileUrl || account.profile_url || account.handle || ''
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

export function AccountsPage({ onNavigate, user }) {
  const load = useCallback(() => apiFetch('/api/accounts').then(data => data.data || []), [])
  const { value: accounts, loading, error, setError, reload } = useApiResource(load, [])
  const [platform, setPlatform] = useState('facebook')
  const [accountName, setAccountName] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [accountStatusFilter, setAccountStatusFilter] = useState('all')
  const [connecting, setConnecting] = useState(false)
  const [connectionNotice, setConnectionNotice] = useState('')
  const [platformHealth, setPlatformHealth] = useState({})
  const [healthLoading, setHealthLoading] = useState(true)
  const accountInputRef = useRef(null)
  const notify = useToast()
  const plan = getPlan(user?.plan)
  const connectionLimit = user?.planUnrestricted ? Infinity : (plan.maxConnections || providers.length)
  const allowedPlatforms = new Set(user?.planUnrestricted || !Array.isArray(user?.allowedPlatforms) || !user.allowedPlatforms.length
    ? providers.map(item => item.platform)
    : user.allowedPlatforms)
  const accountsByPlatform = platformName => accounts.filter(account => account.platform === platformName)
  const selectedAccounts = accountsByPlatform(platform)
  const visibleAccounts = selectedAccounts.filter(account => {
    const query = accountSearch.trim().toLowerCase()
    const label = `${account.name || ''} ${account.handle || ''} ${account.platform || ''}`.toLowerCase()
    const tokenStatus = accountTokenStatus(account)
    const matchesSearch = !query || label.includes(query)
    const matchesStatus = accountStatusFilter === 'all'
      || (accountStatusFilter === 'healthy' && tokenStatus === 'valid')
      || (accountStatusFilter === 'attention' && ['error', 'expiring', 'missing'].includes(tokenStatus))
    return matchesSearch && matchesStatus
  })
  const attentionAccounts = accounts.filter(account => ['error', 'expiring', 'missing'].includes(accountTokenStatus(account))).length
  const connectedPlatforms = new Set(accounts.map(account => account.platform)).size
  const healthyApis = providers.filter(provider => platformHealth[provider.platform] === 'up').length

  useEffect(() => {
    if (allowedPlatforms.has(platform)) return
    const firstAllowed = providers.find(item => allowedPlatforms.has(item.platform))
    if (firstAllowed) setPlatform(firstAllowed.platform)
  }, [platform, user?.allowedPlatforms, user?.planUnrestricted])

  const loadHealth = useCallback(() => apiFetch('/api/platform-health').then(data => setPlatformHealth(data.platforms || {})).catch(() => setPlatformHealth({})).finally(() => setHealthLoading(false)), [])

  useEffect(() => {
    const refreshAfterAuthorization = () => { reload().catch(() => {}); loadHealth() }
    window.addEventListener('focus', refreshAfterAuthorization)
    loadHealth()
    return () => window.removeEventListener('focus', refreshAfterAuthorization)
  }, [reload, loadHealth])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      setConnectionNotice('Conta conectada e sincronizada com o dashboard do Zernio.')
      notify('Conta sincronizada com o Zernio.')
    } else if (params.get('error')) {
      setConnectionNotice('A autorização não foi concluída. Nenhuma conta foi sincronizada com o Zernio.')
    }
    if (params.has('connected') || params.has('error')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [notify])

  async function connect() {
    const name = accountName.trim()

    const selected = providers.find(item => item.platform === platform)
    if (!selected || !allowedPlatforms.has(platform)) {
      const message = 'Essa rede social não está disponível nas redes escolhidas para o seu plano.'
      setError(message)
      notify(message, 'error')
      return
    }
    if (accounts.length >= connectionLimit && !accounts.some(account => account.platform === platform)) {
      const message = `Seu plano permite até ${connectionLimit} contas conectadas.`
      setError(message)
      notify(message, 'error')
      return
    }
    const popup = window.open('', `oauth_${Date.now()}`, 'width=640,height=720')
    setConnecting(true)
    setError('')
    try {
      const params = new URLSearchParams({ accountName: name, platform, returnTo: window.location.pathname })
      const data = await apiFetch(`/auth/${selected.provider}?${params}`)
      if (popup && !popup.closed) popup.location.href = data.authUrl
      else window.open(data.authUrl, '_blank', 'width=640,height=720')
      setAccountName('')
      setConnectionNotice('A autorização foi aberta em outra janela. Ao concluir, volte para cá e a conta será atualizada automaticamente.')
      notify('Janela de autorização aberta.')
    } catch (e) {
      if (popup && !popup.closed) popup.close()
      const message = e instanceof ApiError ? e.message : 'Não foi possível iniciar a conexão.'
      setError(message)
      notify(message, 'error')
    } finally {
      setConnecting(false)
    }
  }

  function openAddAccount(provider, connected, tokenStatus) {
    setPlatform(provider.platform)
    setAccountName(connected.length && tokenStatus !== 'valid'
      ? connected[0].handle || connected[0].name || ''
      : '')
    requestAnimationFrame(() => {
      accountInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      accountInputRef.current?.focus()
    })
  }

  async function remove(id) {
    if (!window.confirm('Deseja realmente desconectar esta conta?')) return
    try { await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' }); await reload(); await loadHealth(); notify('Conta desconectada.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
  }

  return <section className="page-view accounts-page"><section className="panel accounts-panel">
    <div className="panel-heading"><div><p className="eyebrow">INTEGRAÇÕES</p><h2>Contas conectadas</h2></div></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {connectionNotice && <p className="account-connection-notice" role="status">{connectionNotice}</p>}
    <div className="accounts-overview-strip" aria-label="Resumo das integrações"><div><span>Contas conectadas</span><strong>{accounts.length}{Number.isFinite(connectionLimit) ? `/${connectionLimit}` : ''}</strong><small>{connectedPlatforms} redes em uso</small></div><div><span>Precisam de atenção</span><strong className={attentionAccounts ? 'has-warning' : ''}>{attentionAccounts}</strong><small>Tokens expirando ou ausentes</small></div><div><span>APIs disponíveis</span><strong>{healthyApis}/{providers.length}</strong><small>{healthLoading ? 'Verificando agora' : 'Última verificação concluída'}</small></div><div><span>Plataformas do plano</span><strong>{allowedPlatforms.size}</strong><small>{user?.planUnrestricted ? 'Acesso administrativo' : plan.name}</small></div></div>
    <div className="account-platform-grid" aria-label="Status das plataformas">
      {providers.map(provider => {
        const connected = accountsByPlatform(provider.platform)
        const tokenStatuses = connected.map(account => accountTokenStatus(account))
        const tokenStatus = tokenStatuses.includes('error') ? 'error' : tokenStatuses.includes('expiring') ? 'expiring' : tokenStatuses.includes('valid') ? 'valid' : 'missing'
        const healthStatus = platformHealth[provider.platform] || 'unknown'
        const platformAllowed = allowedPlatforms.has(provider.platform)
        const canAdd = platformAllowed && (connected.length > 0 || accounts.length < connectionLimit)
        return <article className={`account-platform-card${connected.length ? ' is-connected' : ''}${!platformAllowed ? ' is-plan-locked' : ''}`} key={provider.platform}>
          <div className="account-platform-card-heading">
            <span className={`account-platform-card-icon account-platform-card-icon-${provider.platform}`} aria-hidden="true"><PlatformIcon platform={provider.platform} className="h-5 w-5" /></span>
            <div><h3>{provider.label}</h3><p>{provider.description}</p></div>
          </div>
          <div className="account-platform-card-status"><span className={`account-status-dot${connected.length && tokenStatus === 'valid' ? ' is-connected' : ''}${tokenStatus === 'error' ? ' is-error' : tokenStatus === 'expiring' ? ' is-warning' : ''}`} aria-hidden="true" />{!platformAllowed ? 'Não incluída no seu plano' : connected.length ? `${connected.length} conta${connected.length > 1 ? 's' : ''} conectada${connected.length > 1 ? 's' : ''}` : 'Nenhuma conta conectada'}</div>
          <div className={`account-health-status account-health-${healthStatus}`}><span aria-hidden="true">{healthStatus === 'up' ? '●' : healthStatus === 'down' ? '!' : '○'}</span>{healthLoading ? 'Verificando API…' : HEALTH_LABELS[healthStatus] || HEALTH_LABELS.unknown}{tokenStatus === 'error' ? ' · Requer reconexão' : tokenStatus === 'expiring' ? ' · Token expirando' : ''}</div>
          <button type="button" className="account-platform-card-action" disabled={!canAdd} onClick={() => openAddAccount(provider, connected, tokenStatus)}>{!platformAllowed ? 'Indisponível' : !canAdd ? 'Limite atingido' : connected.length && tokenStatus !== 'valid' ? 'Reconectar' : connected.length ? 'Adicionar outra' : 'Conectar'}</button>
        </article>
      })}
    </div>
    <div className="mb-6 rounded-lg border border-subtle bg-surface-soft p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-100">Adicionar uma conta</p>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <select value={platform} onChange={event => setPlatform(event.target.value)} aria-label="Plataforma" className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100">
          {providers.filter(item => allowedPlatforms.has(item.platform)).map(item => <option key={item.platform} value={item.platform}>{item.label}</option>)}
        </select>
        <input ref={accountInputRef} value={accountName} onChange={event => setAccountName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') connect() }} placeholder="Cole o link da Página (opcional)" aria-label="Link da Página (opcional)" className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600" />
        <button type="button" onClick={connect} disabled={connecting} className="action-button disabled:cursor-not-allowed disabled:opacity-50">{connecting ? 'Abrindo…' : 'Conectar'}</button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">No Facebook, conecte somente uma Página que você administra. Depois da autorização, escolha a Página correspondente.</p>
    </div>
    <div className="accounts-list-heading"><div><p className="eyebrow">CONTAS AUTORIZADAS · {providers.find(item => item.platform === platform)?.label}</p><h3>{selectedAccounts.length} {selectedAccounts.length === 1 ? 'conta conectada' : 'contas conectadas'}</h3></div><span>{visibleAccounts.length} exibida{visibleAccounts.length === 1 ? '' : 's'}</span></div>
    <div className="accounts-filter-toolbar"><input value={accountSearch} onChange={event => setAccountSearch(event.target.value)} placeholder="Buscar por nome ou rede..." aria-label="Buscar conta"/><select value={accountStatusFilter} onChange={event => setAccountStatusFilter(event.target.value)} aria-label="Filtrar status das contas"><option value="all">Todos os status</option><option value="healthy">Saudáveis</option><option value="attention">Precisam de atenção</option></select></div>
    <div className="accounts-table-heading" aria-hidden="true"><span>Conta e sincronização</span><span>Status do token</span><span>Ações</span></div>
    {loading ? <LoadingState>Carregando contas...</LoadingState> : visibleAccounts.length ? visibleAccounts.map(account => { const tokenStatus = accountTokenStatus(account); const profileUrl = accountProfileUrl(account); return <div className={`data-row account-row${tokenStatus === 'error' ? ' account-row-warning' : ''}`} key={account.id}><span className="account-row-name"><span className={`account-platform-icon account-platform-icon-${account.platform}`} aria-hidden="true"><PlatformIcon platform={account.platform} className="h-4 w-4" /></span><span><strong>{account.name || account.handle || account.platform}</strong><small>{profileUrl ? <a href={profileUrl} target="_blank" rel="noreferrer" className="account-profile-link">{profileUrl}</a> : account.handle || account.platform}</small><small className="account-row-sync">{account.lastSyncAt || account.last_sync_at ? `Última sincronização: ${new Date(account.lastSyncAt || account.last_sync_at).toLocaleString('pt-BR')}` : 'Sincronização ainda não registrada'}</small></span></span><span className={`account-token-status account-token-${tokenStatus}`}>{TOKEN_STATUS_LABELS[tokenStatus] || 'Sem token'}<small>{tokenExpiryText(account)}</small></span><span className="account-row-actions">{tokenStatus !== 'valid' && <button className="link-button" onClick={() => onNavigate?.('tokens')}>{tokenStatus === 'missing' ? 'Configurar token' : 'Renovar token'}</button>}<button className="link-button" onClick={() => remove(account.id)}>Desconectar</button></span></div> }) : <div className="accounts-empty"><span aria-hidden="true">◎</span><p>{selectedAccounts.length ? 'Nenhuma conta corresponde aos filtros.' : `Nenhuma conta ${providers.find(item => item.platform === platform)?.label || ''} conectada.`}</p>{selectedAccounts.length > 0 && <button className="link-button" onClick={() => { setAccountSearch(''); setAccountStatusFilter('all') }}>Limpar filtros</button>}</div>}
  </section></section>
}
