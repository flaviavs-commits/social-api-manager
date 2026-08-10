import { useEffect, useMemo, useState } from 'react'
import { API_URL, ApiError, publicApiFetch } from '../lib/api.js'
import { ThemeSelector } from '../components/ui/theme-selector.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validEmail(email) {
  return EMAIL_PATTERN.test(email.trim())
}

function maskEmail(email) {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const mask = (value, keepEnd = false) => {
    if (value.length <= 2) return `${value[0] || ''}${'*'.repeat(Math.max(1, value.length - 1))}`
    const end = keepEnd ? value.slice(-2) : ''
    return `${value.slice(0, 2)}${'*'.repeat(Math.max(1, value.length - 2 - end.length))}${end}`
  }
  const domainParts = domain.split('.')
  return `${mask(local, true)}@${mask(domainParts[0])}${domainParts.slice(1).length ? `.${domainParts.slice(1).join('.')}` : ''}`
}

function passwordRules(password) {
  return {
    length: password.length >= 6 && password.length <= 72,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  }
}

function Message({ message }) {
  if (!message) return null
  return <p className={`auth-message auth-message--${message.type}`} role="alert">{message.text}</p>
}

function AuthCard({ children }) {
  return <main className="auth-page"><section className="auth-card"><div className="auth-card-toolbar"><ThemeSelector /></div><a className="auth-brand" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/logo.svg" alt="Meu Ecoo Mídia" /></a>{children}</section></main>
}

export function LoginPage() {
  const [register, setRegister] = useState(false)
  const [flow, setFlow] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const queryError = useMemo(() => new URLSearchParams(window.location.search).get('error'), [])

  useEffect(() => {
    if (queryError) setMessage({ type: 'error', text: queryError })
  }, [queryError])

  const submitCredentials = async event => {
    event.preventDefault()
    if (!validEmail(email)) return setMessage({ type: 'error', text: 'Informe um e-mail válido.' })
    setBusy(true)
    setMessage(null)
    try {
      const endpoint = register ? '/auth/login/register' : '/auth/login/login'
      const data = await publicApiFetch(endpoint, { method: 'POST', body: JSON.stringify({ email: email.trim(), password, fullName: fullName.trim() || undefined }) })
      if (data.requires2fa) {
        setFlow('login-2fa')
        return
      }
      window.location.assign('/app.html')
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof ApiError ? error.message : 'Não foi possível conectar ao servidor.' })
    } finally {
      setBusy(false)
    }
  }

  const verifyLoginCode = async event => {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) return setMessage({ type: 'error', text: 'Digite o código de 6 dígitos do app autenticador.' })
    setBusy(true)
    try {
      await publicApiFetch('/auth/login/verify-2fa', { method: 'POST', body: JSON.stringify({ code }) })
      window.location.assign('/app.html')
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Não foi possível verificar o código.' })
    } finally { setBusy(false) }
  }

  const verifyResetCode = async event => {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) return setMessage({ type: 'error', text: 'Digite o código de 6 dígitos do app autenticador.' })
    setBusy(true)
    try {
      const data = await publicApiFetch('/auth/login/reset-2fa', { method: 'POST', body: JSON.stringify({ email: email.trim(), code }) })
      window.location.assign(`/reset-password.html?token=${encodeURIComponent(data.token)}`)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Não foi possível verificar o código.' })
    } finally { setBusy(false) }
  }

  const startReset = event => {
    event.preventDefault()
    if (!validEmail(email)) return setMessage({ type: 'error', text: 'Informe um e-mail válido.' })
    setFlow('forgot-2fa')
    setCode('')
    setMessage(null)
  }

  const title = register ? 'Criar conta' : flow === 'login-2fa' ? 'Confirmar acesso' : 'Bem-vindo de volta'

  return <AuthCard>
    <h1 className="auth-title">{title}</h1>
    <p className="auth-subtitle">Entre para acessar o gerenciador das suas redes sociais</p>
    <Message message={message} />

    {flow === 'login-2fa' && <form onSubmit={verifyLoginCode} className="auth-form">
      <p className="auth-help">Digite o código de 6 dígitos do seu app autenticador.</p>
      <input className="auth-input auth-input--code" inputMode="numeric" maxLength="6" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus />
      <button className="auth-button" disabled={busy}>{busy ? 'Verificando…' : 'Confirmar'}</button>
    </form>}

    {flow === 'forgot-2fa' && <form onSubmit={verifyResetCode} className="auth-form">
      <p className="auth-help">Digite o código do autenticador para <strong>{maskEmail(email)}</strong>.</p>
      <input className="auth-input auth-input--code" inputMode="numeric" maxLength="6" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus />
      <button className="auth-button" disabled={busy}>{busy ? 'Verificando…' : 'Verificar código'}</button>
      <button type="button" className="auth-button auth-button--secondary" onClick={() => setFlow('forgot-email')}>Corrigir e-mail</button>
    </form>}

    {flow === 'forgot-email' && <form onSubmit={startReset} className="auth-form">
      <label className="auth-label" htmlFor="forgot-email">Informe seu e-mail</label>
      <input id="forgot-email" className="auth-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoFocus required />
      <button className="auth-button">Continuar</button>
    </form>}

    {flow === 'login' && <>
      <form onSubmit={submitCredentials} className="auth-form">
        {register && <><label className="auth-label" htmlFor="full-name">Nome</label><input id="full-name" className="auth-input" value={fullName} onChange={event => setFullName(event.target.value)} /></>}
        <label className="auth-label" htmlFor="email">E-mail</label>
        <input id="email" className="auth-input" type="email" value={email} onChange={event => setEmail(event.target.value)} required />
        <label className="auth-label" htmlFor="password">Senha</label>
        <input id="password" className="auth-input" type="password" value={password} onChange={event => setPassword(event.target.value)} required />
        {register && <p className="auth-help">Use pelo menos 6 caracteres, uma maiúscula, um número e um caractere especial.</p>}
        <button className="auth-button" disabled={busy}>{busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}</button>
      </form>
      {!register && <a className="auth-link auth-forgot" href="#forgot" onClick={event => { event.preventDefault(); setFlow('forgot-email'); setMessage(null) }}>Esqueceu sua senha?</a>}
      <div className="auth-divider"><span>ou</span></div>
      <a className="auth-button auth-button--google" href={`${API_URL}/auth/login/google`}>Continuar com o Google</a>
    </>}

    {flow !== 'login-2fa' && <p className="auth-switch">{register ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <button type="button" className="auth-link" onClick={() => { setRegister(value => !value); setFlow('login'); setMessage(null) }}>{register ? 'Entrar' : 'Criar conta'}</button></p>}
    {flow === 'forgot-email' || flow === 'forgot-2fa' ? <p className="auth-switch"><button type="button" className="auth-link" onClick={() => { setFlow('login'); setMessage(null) }}>Voltar para o login</button></p> : null}
    <p className="auth-legal"><a href="/privacy-policy">Política de Privacidade</a><a href="/terms-of-service">Termos de Uso</a></p>
  </AuthCard>
}

export function ResetPasswordPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])
  const [valid, setValid] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const rules = passwordRules(password)

  useEffect(() => {
    if (!token) return setValid(false)
    publicApiFetch(`/auth/login/reset-password/validar?token=${encodeURIComponent(token)}`).then(data => setValid(data.valido)).catch(() => setValid(false))
  }, [token])

  const submit = async event => {
    event.preventDefault()
    if (!Object.values(rules).every(Boolean)) return setMessage({ type: 'error', text: 'A senha precisa ter no mínimo 6 caracteres, uma maiúscula, um número e um caractere especial.' })
    if (password !== confirmation) return setMessage({ type: 'error', text: 'As senhas não são iguais.' })
    setBusy(true)
    try {
      await publicApiFetch('/auth/login/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) })
      setMessage({ type: 'success', text: 'Senha redefinida com sucesso! Redirecionando para o login…' })
      setTimeout(() => window.location.assign('/login.html'), 1800)
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Não foi possível redefinir sua senha.' }) }
    finally { setBusy(false) }
  }

  return <AuthCard><h1 className="auth-title">Criar nova senha</h1><p className="auth-subtitle">{valid === null ? 'Verificando seu link…' : valid ? 'Escolha uma nova senha para acessar sua conta.' : 'Esse link não é mais válido ou já expirou.'}</p><Message message={message} />{valid && <form onSubmit={submit} className="auth-form"><label className="auth-label" htmlFor="new-password">Nova senha</label><input id="new-password" className="auth-input" type="password" value={password} onChange={event => setPassword(event.target.value)} autoFocus required /><div className="auth-rules">{Object.entries({ length: 'mínimo 6 caracteres', uppercase: '1 letra maiúscula', number: '1 número', special: '1 caractere especial' }).map(([key, label]) => <span key={key} className={rules[key] ? 'is-valid' : ''}>{rules[key] ? '✓' : '○'} {label}</span>)}</div><label className="auth-label" htmlFor="confirm-password">Confirme a nova senha</label><input id="confirm-password" className="auth-input" type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required /><button className="auth-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button></form>}<p className="auth-switch"><a className="auth-link" href="/login.html">Voltar para o login</a></p></AuthCard>
}

export function VerifyTwoFactorPage() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const submit = async event => {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) return setMessage({ type: 'error', text: 'Digite o código de 6 dígitos do app autenticador.' })
    setBusy(true)
    try {
      await publicApiFetch('/auth/login/verify-2fa', { method: 'POST', body: JSON.stringify({ code }) })
      window.location.assign('/app.html')
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Não foi possível verificar o código.' }) }
    finally { setBusy(false) }
  }

  return <AuthCard><h1 className="auth-title">Verificação em 2 fatores</h1><p className="auth-subtitle">Digite o código de 6 dígitos do seu app autenticador para concluir o login.</p><Message message={message} /><form onSubmit={submit} className="auth-form"><input className="auth-input auth-input--code" inputMode="numeric" maxLength="6" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus required /><button className="auth-button" disabled={busy}>{busy ? 'Verificando…' : 'Confirmar'}</button></form><p className="auth-switch"><a className="auth-link" href="/login.html">Voltar para o login</a></p></AuthCard>
}
