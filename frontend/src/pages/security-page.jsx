import { useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'

export function SecurityPage({ user }) {
  const [enabled, setEnabled] = useState(Boolean(user?.totpEnabled))
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const notify = useToast()

  async function startSetup() {
    setBusy(true)
    setError('')
    try { setSetup(await apiFetch('/api/me/2fa/setup', { method: 'POST' })); setCode(''); notify('QR Code gerado. Confirme para ativar o 2FA.') }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
    finally { setBusy(false) }
  }

  async function enable() {
    if (!/^\d{6}$/.test(code)) { setError('Digite o código de 6 dígitos do seu autenticador.'); return }
    setBusy(true)
    setError('')
    try { await apiFetch('/api/me/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }); setEnabled(true); setSetup(null); setCode(''); notify('Autenticação em 2 fatores ativada.') }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
    finally { setBusy(false) }
  }

  async function disable() {
    if (!/^\d{6}$/.test(code)) { setError('Digite o código atual do autenticador para desativar.'); return }
    setBusy(true)
    setError('')
    try { await apiFetch('/api/me/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }); setEnabled(false); setSetup(null); setCode(''); notify('Autenticação em 2 fatores desativada.') }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
    finally { setBusy(false) }
  }

  return <section className="page-view security-page"><section className="panel security-panel">
    <div className="panel-heading"><div><p className="eyebrow">SEGURANÇA</p><h2>Proteja sua conta</h2><p className="panel-subtitle">Use um aplicativo autenticador para adicionar uma camada extra ao login.</p></div><span className={`security-status security-status-${enabled ? 'enabled' : 'disabled'}`}>{enabled ? '● 2FA ativo' : '○ 2FA desativado'}</span></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {!enabled && !setup && <div className="security-intro"><div className="security-icon" aria-hidden="true">⌁</div><div><h3>Ative a autenticação em 2 fatores</h3><p>Depois de ativar, além da senha você precisará de um código temporário do Google Authenticator, Authy ou outro app compatível.</p><button type="button" className="action-button" onClick={startSetup} disabled={busy}>{busy ? 'Gerando…' : 'Configurar 2FA'}</button></div></div>}
    {setup && !enabled && <div className="security-setup"><div><h3>1. Escaneie o QR Code</h3><p>Abra seu aplicativo autenticador e escaneie esta imagem. Se preferir, use a chave manual abaixo.</p><img className="security-qr" src={setup.qrCodeDataUrl} alt="QR Code para configurar autenticação em 2 fatores"/><code className="security-secret">{setup.secret}</code></div><div className="security-confirm"><h3>2. Confirme o código</h3><p>Digite o código de 6 dígitos exibido no aplicativo.</p><label>Código do autenticador<input inputMode="numeric" maxLength="6" autoFocus value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000"/></label><button type="button" className="action-button" onClick={enable} disabled={busy}>{busy ? 'Confirmando…' : 'Ativar proteção'}</button></div></div>}
    {enabled && <div className="security-enabled"><div className="security-icon security-icon-success" aria-hidden="true">✓</div><div><h3>Sua conta está protegida</h3><p>O código do seu autenticador será solicitado sempre que você fizer login novamente.</p><div className="security-disable"><label>Para desativar, informe um código atual<input inputMode="numeric" maxLength="6" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000"/></label><button type="button" className="link-button danger-link" onClick={disable} disabled={busy}>{busy ? 'Desativando…' : 'Desativar 2FA'}</button></div></div></div>}
  </section></section>
}
