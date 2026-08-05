import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { useToast } from '../components/ui/toast.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'

const STATUS_LABELS = { valid: 'Válido', expiring: 'Expirando', expired: 'Expirado', error: 'Com erro' }

function expiryText(value) {
  if (!value) return 'Sem expiração informada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Expiração indisponível' : `Expira em ${date.toLocaleDateString('pt-BR')}`
}

export function TokensPage() {
  const load = useCallback(() => apiFetch('/api/tokens').then(data => data.tokens || []), [])
  const { value: tokens, loading, error, setError, reload } = useApiResource(load, [])
  const [renewingId, setRenewingId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const notify = useToast()
  const visibleTokens = tokens.filter(token => {
    const query = search.trim().toLowerCase()
    const label = `${token.account_name || token.accountName || ''} ${token.platform || ''}`.toLowerCase()
    return (!query || label.includes(query)) && (statusFilter === 'all' || (token.status || 'valid') === statusFilter) && (platformFilter === 'all' || token.platform === platformFilter)
  })
  const attentionCount = tokens.filter(token => ['expiring', 'expired', 'error'].includes(token.status)).length

  async function remove(id) {
    if (!window.confirm('Remover este token de acesso?')) return
    try { await apiFetch(`/api/tokens/${id}`, { method: 'DELETE' }); await reload() }
    catch (e) { setError(e.message) }
  }

  async function renew(id) {
    setRenewingId(id)
    try { await apiFetch(`/api/tokens/renew/${id}`, { method: 'POST' }); await reload(); notify('Token renovado.') }
    catch (e) { setError(e.message); notify(e.message, 'error') }
    finally { setRenewingId(null) }
  }

  return <section className="page-view tokens-page"><section className="panel tokens-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">CREDENCIAIS</p><h2>Tokens de acesso</h2></div>
      <button className="action-button" disabled={loading || !tokens.length} onClick={async () => { try { await apiFetch('/api/tokens/renew-all', { method: 'POST' }); await reload(); notify('Tokens renovados.') } catch (e) { setError(e.message); notify(e.message, 'error') } }}>Renovar todos</button>
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {attentionCount > 0 && <div className="token-attention-banner" role="status"><span aria-hidden="true">!</span><div><strong>{attentionCount} {attentionCount === 1 ? 'token precisa' : 'tokens precisam'} de atenção</strong><p>Renove os tokens expirando ou com erro para manter as publicações e métricas funcionando.</p></div></div>}
    <div className="token-summary-grid"><div><span>Total</span><strong>{tokens.length}</strong></div><div><span>Válidos</span><strong>{tokens.filter(token => (token.status || 'valid') === 'valid').length}</strong></div><div><span>Precisam de atenção</span><strong>{attentionCount}</strong></div></div>
    <div className="token-filter-toolbar"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar conta ou rede..." aria-label="Buscar token"/><select value={platformFilter} onChange={event => setPlatformFilter(event.target.value)} aria-label="Filtrar tokens por rede"><option value="all">Todas as redes</option>{[...new Set(tokens.map(token => token.platform).filter(Boolean))].map(platform => <option key={platform} value={platform}>{platform}</option>)}</select><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filtrar tokens por status"><option value="all">Todos os status</option><option value="valid">Válidos</option><option value="expiring">Expirando</option><option value="expired">Expirados</option><option value="error">Com erro</option></select></div>
    <div className="token-table-heading" aria-hidden="true"><span>Conta e rede</span><span>Validade</span><span>Status</span><span>Ações</span></div>
    {loading ? <LoadingState>Carregando tokens...</LoadingState> : visibleTokens.length ? <div className="token-list">{visibleTokens.map(token => <div className={`data-row token-row token-row-${token.status || 'valid'}`} key={token.id}><span className="token-row-name"><span className={`token-platform-icon token-platform-icon-${token.platform}`} aria-hidden="true"><PlatformIcon platform={token.platform} className="h-4 w-4" /></span><span><strong>{token.account_name || token.accountName || token.platform}</strong><small>{token.platform || 'Rede não identificada'}</small><small className="token-last-used">{token.last_used_at || token.lastUsedAt ? `Último uso: ${new Date(token.last_used_at || token.lastUsedAt).toLocaleString('pt-BR')}` : 'Último uso não informado'}</small></span></span><span className="token-row-expiry">{expiryText(token.expires_at || token.expiresAt)}</span><span className={`token-status-badge token-status-${token.status || 'valid'}`}>{STATUS_LABELS[token.status] || 'Válido'}</span><span className="token-row-actions">{token.status !== 'valid' && <button className="link-button" disabled={renewingId === token.id} onClick={() => renew(token.id)}>{renewingId === token.id ? 'Renovando…' : 'Renovar'}</button>}<button className="link-button danger-link" onClick={() => remove(token.id)}>Revogar</button></span></div>)}</div> : <div className="token-empty"><span aria-hidden="true">🔐</span><p>{tokens.length ? 'Nenhum token corresponde aos filtros.' : 'Nenhum token cadastrado.'}</p>{tokens.length > 0 && <button className="link-button" onClick={() => { setSearch(''); setPlatformFilter('all'); setStatusFilter('all') }}>Limpar filtros</button>}</div>}
  </section></section>
}
