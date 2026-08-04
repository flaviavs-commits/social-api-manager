import { useCallback } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'

export function TokensPage() {
  const load = useCallback(() => apiFetch('/api/tokens').then(data => data.tokens || []), [])
  const { value: tokens, loading, error, setError, reload } = useApiResource(load, [])

  async function remove(id) {
    try { await apiFetch(`/api/tokens/${id}`, { method: 'DELETE' }); await reload() }
    catch (e) { setError(e.message) }
  }

  return <section className="page-view"><section className="panel">
    <div className="panel-heading">
      <div><p className="eyebrow">CREDENCIAIS</p><h2>Tokens de acesso</h2></div>
      <button className="action-button" onClick={async () => { try { await apiFetch('/api/tokens/renew-all', { method: 'POST' }); await reload() } catch (e) { setError(e.message) } }}>Renovar todos</button>
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading ? <p className="empty-state" aria-live="polite">Carregando tokens...</p> : tokens.length ? tokens.map(token => <div className="data-row" key={token.id}><span>{token.account_name || token.platform}</span><small>{token.status || 'valid'}</small><button className="link-button" onClick={() => remove(token.id)}>Remover</button></div>) : <p className="empty-state">Nenhum token cadastrado.</p>}
  </section></section>
}
