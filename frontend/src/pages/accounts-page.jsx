import { useCallback } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'

export function AccountsPage() {
  const load = useCallback(() => apiFetch('/api/accounts').then(data => data.data || []), [])
  const { value: accounts, loading, error, setError, reload } = useApiResource(load, [])

  async function remove(id) {
    try { await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' }); await reload() }
    catch (e) { setError(e.message) }
  }

  return <section className="page-view"><section className="panel">
    <p className="eyebrow">INTEGRAÇÕES</p><h2>Contas conectadas</h2>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading ? <p className="empty-state" aria-live="polite">Carregando contas...</p> : accounts.length ? accounts.map(account => <div className="data-row" key={account.id}><span>{account.name || account.handle || account.platform}</span><button className="link-button" onClick={() => remove(account.id)}>Desconectar</button></div>) : <p className="empty-state">Nenhuma conta conectada.</p>}
  </section></section>
}
