import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'

export function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => { setLoading(true); return apiFetch('/api/accounts').then(data => setAccounts(data.data || [])).catch(e => setError(e.message)).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  async function remove(id) {
    try { await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' }); load() }
    catch (e) { setError(e.message) }
  }

  return <section className="page-view"><section className="panel">
    <p className="eyebrow">INTEGRAÇÕES</p><h2>Contas conectadas</h2>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading ? <p className="empty-state" aria-live="polite">Carregando contas...</p> : accounts.length ? accounts.map(account => <div className="data-row" key={account.id}><span>{account.name || account.handle || account.platform}</span><button className="link-button" onClick={() => remove(account.id)}>Desconectar</button></div>) : <p className="empty-state">Nenhuma conta conectada.</p>}
  </section></section>
}
