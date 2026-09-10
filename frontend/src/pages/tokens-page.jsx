import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { useToast } from '../components/ui/toast.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'

const STATUS_LABELS = { valid: 'Válido', expiring: 'Expirando', expired: 'Expirado', error: 'Com erro' }
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }

function tokenStatus(token) {
  return token.status || 'valid'
}

function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform || 'Rede não identificada'
}

function expiryText(value) {
  if (!value) return 'Sem expiração informada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Expiração indisponível' : `Expira em ${date.toLocaleDateString('pt-BR')}`
}

function lastUsedText(token) {
  const value = token.last_used_at || token.lastUsedAt
  if (!value) return 'Último uso não informado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Último uso não informado' : `Último uso em ${date.toLocaleDateString('pt-BR')}`
}

export function TokensPage() {
  const load = useCallback(() => apiFetch('/api/tokens').then(data => data.tokens || []), [])
  const { value: tokens, loading, error, setError, reload } = useApiResource(load, [])
  const [renewingId, setRenewingId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const notify = useToast()
  const attentionCount = tokens.filter(token => ['expiring', 'expired', 'error'].includes(tokenStatus(token))).length
  const validCount = tokens.filter(token => tokenStatus(token) === 'valid').length
  const platformOptions = [...new Set(tokens.map(token => token.platform).filter(Boolean))]
  const visibleTokens = tokens.filter(token => {
    const query = search.trim().toLowerCase()
    const label = `${token.account_name || token.accountName || ''} ${platformLabel(token.platform)}`.toLowerCase()
    const status = tokenStatus(token)
    return (!query || label.includes(query)) && (statusFilter === 'all' || status === statusFilter) && (platformFilter === 'all' || token.platform === platformFilter)
  })

  async function remove(id) {
    if (!window.confirm('Remover este token de acesso?')) return
    try { await apiFetch(`/api/tokens/${id}`, { method: 'DELETE' }); await reload(); notify('Token revogado.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
  }

  async function renew(id) {
    setRenewingId(id)
    try { await apiFetch(`/api/tokens/renew/${id}`, { method: 'POST' }); await reload(); notify('Token renovado.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
    finally { setRenewingId(null) }
  }

  async function renewAll() {
    setRenewingId('all')
    try { await apiFetch('/api/tokens/renew-all', { method: 'POST' }); await reload(); notify('Tokens renovados.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
    finally { setRenewingId(null) }
  }

  function clearFilters() {
    setSearch('')
    setPlatformFilter('all')
    setStatusFilter('all')
  }

  return <section className="page-view tokens-page">
    <section className="tokens-hero">
      <div className="tokens-hero-copy">
        <span className="tokens-hero-icon" aria-hidden="true">⌁</span>
        <div>
          <p className="eyebrow">SEGURANÇA E ACESSO</p>
          <h2>Tokens de acesso</h2>
          <p>Gerencie as credenciais que permitem publicar e consultar dados das suas redes sociais.</p>
        </div>
      </div>
      <div className="tokens-hero-actions">
        <span className={`tokens-health-pill${attentionCount ? ' is-attention' : ''}`}><i aria-hidden="true" />{attentionCount ? `${attentionCount} em atenção` : 'Tudo protegido'}</span>
        <button type="button" className="action-button" disabled={loading || !tokens.length || renewingId !== null} onClick={renewAll}><span aria-hidden="true">↻</span>{renewingId === 'all' ? 'Renovando…' : 'Renovar todos'}</button>
      </div>
    </section>

    {error && <p className="error-message tokens-error" role="alert">{error}</p>}

    {attentionCount > 0 && <div className="token-attention-banner" role="status"><span className="token-attention-icon" aria-hidden="true">!</span><div><strong>{attentionCount} {attentionCount === 1 ? 'token precisa' : 'tokens precisam'} de atenção</strong><p>Renove os tokens expirando ou com erro para manter as publicações e métricas funcionando.</p></div></div>}

    <div className="token-summary-grid" aria-label="Resumo dos tokens">
      <article className="token-summary-card token-summary-total"><span className="token-summary-icon" aria-hidden="true">⌘</span><div><span>Total conectado</span><strong>{tokens.length}</strong><small>Credenciais cadastradas</small></div></article>
      <article className="token-summary-card token-summary-valid"><span className="token-summary-icon" aria-hidden="true">✓</span><div><span>Funcionando</span><strong>{validCount}</strong><small>Prontas para uso</small></div></article>
      <article className={`token-summary-card token-summary-attention${attentionCount ? ' is-active' : ''}`}><span className="token-summary-icon" aria-hidden="true">!</span><div><span>Precisam de atenção</span><strong>{attentionCount}</strong><small>{attentionCount ? 'Revise agora' : 'Nenhuma pendência'}</small></div></article>
    </div>

    <section className="panel tokens-panel">
      <div className="tokens-list-heading">
        <div><p className="eyebrow">COFRE DE CREDENCIAIS</p><h3>Contas autorizadas</h3><p>Veja o estado de cada integração e revogue acessos que você não usa mais.</p></div>
        <span className="token-results-count">{visibleTokens.length} de {tokens.length}</span>
      </div>

      <div className="token-filter-toolbar">
        <label className="token-search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar conta ou rede..." aria-label="Buscar token" /></label>
        <label className="token-filter-select"><span>Rede</span><select value={platformFilter} onChange={event => setPlatformFilter(event.target.value)} aria-label="Filtrar tokens por rede"><option value="all">Todas as redes</option>{platformOptions.map(platform => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}</select></label>
        <label className="token-filter-select"><span>Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filtrar tokens por status"><option value="all">Todos os status</option><option value="valid">Válidos</option><option value="expiring">Expirando</option><option value="expired">Expirados</option><option value="error">Com erro</option></select></label>
      </div>

      <div className="token-table-heading" aria-hidden="true"><span>Conta e integração</span><span>Validade</span><span>Estado</span><span>Ações</span></div>
      {loading ? <LoadingState>Carregando tokens...</LoadingState> : visibleTokens.length ? <div className="token-list">{visibleTokens.map(token => {
        const status = tokenStatus(token)
        const accountName = token.account_name || token.accountName || platformLabel(token.platform)
        return <article className={`token-row token-row-${status}`} key={token.id}>
          <div className="token-row-main"><span className={`token-platform-icon token-platform-icon-${token.platform}`} aria-hidden="true"><PlatformIcon platform={token.platform} className="h-5 w-5" /></span><div className="token-row-copy"><strong>{accountName}</strong><span className="token-platform-label"><PlatformIcon platform={token.platform} className="h-3 w-3" />{platformLabel(token.platform)}</span><small>{lastUsedText(token)}</small></div></div>
          <div className="token-row-expiry"><span>Validade</span><strong>{expiryText(token.expires_at || token.expiresAt)}</strong></div>
          <div className={`token-status-badge token-status-${status}`}><i aria-hidden="true" />{STATUS_LABELS[status] || 'Válido'}</div>
          <div className="token-row-actions">{status !== 'valid' && <button type="button" className="link-button" disabled={renewingId !== null} onClick={() => renew(token.id)}>{renewingId === token.id ? 'Renovando…' : 'Renovar'}</button>}<button type="button" className="link-button danger-link" disabled={renewingId !== null} onClick={() => remove(token.id)}>Revogar</button></div>
        </article>
      })}</div> : <div className="token-empty"><span className="token-empty-icon" aria-hidden="true">⌁</span><strong>{tokens.length ? 'Nenhum token encontrado' : 'Nenhum token cadastrado'}</strong><p>{tokens.length ? 'Tente mudar os filtros ou buscar por outra conta.' : 'Conecte uma rede social para começar a publicar e acompanhar seus dados.'}</p>{tokens.length > 0 && <button type="button" className="secondary-button" onClick={clearFilters}>Limpar filtros</button>}</div>}
    </section>
  </section>
}
