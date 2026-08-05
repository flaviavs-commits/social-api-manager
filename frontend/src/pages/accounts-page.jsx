import { useCallback, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'

const providers = [
  { platform: 'facebook', provider: 'meta', label: 'Facebook', description: 'Páginas e perfis comerciais' },
  { platform: 'instagram', provider: 'instagram', label: 'Instagram', description: 'Contas profissionais' },
  { platform: 'youtube', provider: 'google', label: 'YouTube', description: 'Canais de vídeo' },
  { platform: 'tiktok', provider: 'tiktok', label: 'TikTok', description: 'Contas de criador' },
]

export function AccountsPage() {
  const load = useCallback(() => apiFetch('/api/accounts').then(data => data.data || []), [])
  const { value: accounts, loading, error, setError, reload } = useApiResource(load, [])
  const [platform, setPlatform] = useState('facebook')
  const [accountName, setAccountName] = useState('')
  const [connecting, setConnecting] = useState(false)

  async function connect() {
    const name = accountName.trim()
    if (!name) {
      setError('Informe o nome ou link da conta antes de conectar.')
      return
    }

    const selected = providers.find(item => item.platform === platform)
    const popup = window.open('', `oauth_${Date.now()}`, 'width=640,height=720')
    setConnecting(true)
    setError('')
    try {
      const params = new URLSearchParams({ accountName: name, platform })
      const data = await apiFetch(`/auth/${selected.provider}?${params}`)
      if (popup && !popup.closed) popup.location.href = data.authUrl
      else window.open(data.authUrl, '_blank', 'width=640,height=720')
      setAccountName('')
    } catch (e) {
      if (popup && !popup.closed) popup.close()
      setError(e instanceof ApiError ? e.message : 'Não foi possível iniciar a conexão.')
    } finally {
      setConnecting(false)
    }
  }

  async function remove(id) {
    try { await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' }); await reload() }
    catch (e) { setError(e.message) }
  }

  return <section className="page-view"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">INTEGRAÇÕES</p><h2>Contas conectadas</h2></div></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="mb-6 rounded-lg border border-subtle bg-surface-soft p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-100">Adicionar uma conta</p>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <select value={platform} onChange={event => setPlatform(event.target.value)} aria-label="Plataforma" className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100">
          {providers.map(item => <option key={item.platform} value={item.platform}>{item.label}</option>)}
        </select>
        <input value={accountName} onChange={event => setAccountName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') connect() }} placeholder="Nome de usuário ou link do perfil" aria-label="Nome ou link da conta" className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600" />
        <button type="button" onClick={connect} disabled={connecting} className="action-button disabled:cursor-not-allowed disabled:opacity-50">{connecting ? 'Abrindo…' : 'Conectar'}</button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Você será levado à página oficial de autorização da plataforma.</p>
    </div>
    {loading ? <p className="empty-state" aria-live="polite">Carregando contas...</p> : accounts.length ? accounts.map(account => <div className="data-row" key={account.id}><span>{account.name || account.handle || account.platform}</span><button className="link-button" onClick={() => remove(account.id)}>Desconectar</button></div>) : <p className="empty-state">Nenhuma conta conectada.</p>}
  </section></section>
}
