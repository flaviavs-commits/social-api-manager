import { useEffect, useMemo, useState } from 'react'
import { API_URL, ApiError, apiFetch, publicApiFetch } from '../lib/api.js'
import { ThemeSelector } from '../components/ui/theme-selector.jsx'
import { DEFAULT_PLAN, PLANS } from '../lib/plans.js'
import { CopyrightNotice } from '../components/ui/copyright-notice.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8
const VALID_PLANS = new Set(Object.keys(PLANS))

function formatPlanPrice(priceCents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(priceCents || 0) / 100)
}

const AUTH_ERROR_MESSAGES = new Set([
  'Login com Google cancelado.',
  'Sessão de login inválida ou expirada. Tente novamente.',
  'Não foi possível entrar com o Google agora. Tente novamente em alguns minutos.',
  'Não foi possível obter seu e-mail do Google.'
])

const ACCOUNT_PLANS = Object.values(PLANS).map(plan => ({
  id: plan.id,
  name: plan.name,
  price: plan.checkoutPrice,
  priceCents: plan.priceCents,
  meuEcooAccess: plan.meuEcooAccess || 'none',
  meuEcooDiscountPercent: plan.meuEcooDiscountPercent || 0,
  meuEcooOffer: plan.meuEcooOffer || 'Sem acesso ao MeuEcoo',
  cadence: plan.cadence,
  maxConnections: plan.maxConnections,
  availablePlatforms: plan.availablePlatforms,
  description: plan.description,
  features: plan.features,
  featured: plan.id === 'pro',
}))

const PLATFORM_OPTIONS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
]

// Parâmetros da tela de autenticação são apenas estado de apresentação. Não
// devem aceitar HTML, URLs de redirecionamento, planos arbitrários ou texto
// ilimitado vindo da barra de endereço.
export function parseLoginQuery(search = '') {
  const params = new URLSearchParams(search)
  const rawPlan = params.get('plan')
  const rawError = params.get('error')
  return {
    register: params.get('register') === '1',
    selectedPlan: VALID_PLANS.has(rawPlan) ? rawPlan : null,
    error: AUTH_ERROR_MESSAGES.has(rawError) ? rawError : null
  }
}

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
    length: password.length >= PASSWORD_MIN_LENGTH && password.length <= 72,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  }
}

function Message({ message }) {
  if (!message) return null
  return <div className={`auth-message auth-message--${message.type}`} role="alert"><span>{message.text}</span>{message.action && <button type="button" className="auth-message-action" onClick={message.action.onClick}>{message.action.label}</button>}</div>
}

function AuthCard({ children }) {
  return <main className="auth-page"><section className="auth-card"><div className="auth-card-toolbar"><ThemeSelector /></div><a className="auth-brand" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/logo.png" alt="Meu Ecoo Mídia" /></a>{children}<CopyrightNotice /></section></main>
}

function appPathForPlan(planActive) {
  return planActive === false ? '/app/perfil' : '/app.html'
}

export function LoginPage() {
  const initialQuery = useMemo(() => parseLoginQuery(window.location.search), [])
  const { selectedPlan, error: queryError } = initialQuery
  const [register, setRegister] = useState(initialQuery.register)
  const [flow, setFlow] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (queryError) setMessage({ type: 'error', text: queryError })
  }, [queryError])

  useEffect(() => {
    // Remove register/plan/error e qualquer parâmetro desconhecido do
    // histórico assim que a tela é carregada. Isso reduz exposição em
    // histórico, screenshots, referrers e ferramentas de suporte.
    if (window.location.search) {
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`)
    }
  }, [])

  const submitCredentials = async event => {
    event.preventDefault()
    if (!validEmail(email)) return setMessage({ type: 'error', text: 'Informe um e-mail válido.' })
    if (register && !Object.values(passwordRules(password)).every(Boolean)) return setMessage({ type: 'error', text: 'A senha precisa ter de 8 a 72 caracteres, uma maiúscula, um número e um caractere especial.' })
    setBusy(true)
    setMessage(null)
    try {
      const endpoint = register ? '/auth/login/register' : '/auth/login/login'
      const data = await publicApiFetch(endpoint, { method: 'POST', body: JSON.stringify({ email: email.trim(), password, fullName: fullName.trim() || undefined, plan: register ? selectedPlan || undefined : undefined }) })
      if (register && data.requiresPayment && data.selectedPlan) {
        const billing = await apiFetch('/api/billing/plan-change', { method: 'POST', body: JSON.stringify({ plan: data.selectedPlan }) })
        if (!billing.checkoutUrl) throw new ApiError('O checkout não foi criado. Tente novamente em instantes.', 503)
        window.location.assign(billing.checkoutUrl)
        return
      }
      if (data.requires2fa) {
        if (data.passwordUpgradeRecommended) {
          setMessage({ type: 'warning', text: 'Sua senha atual ainda funciona, mas é mais curta que o padrão de segurança. Recomendamos trocar por uma senha com pelo menos 8 caracteres.', action: { label: 'Trocar senha agora', onClick: () => { setFlow('forgot-email'); setMessage(null) } } })
        }
        setFlow('login-2fa')
        return
      }
      if (data.passwordUpgradeRecommended) {
        const redirectTimer = window.setTimeout(() => window.location.assign(appPathForPlan(data.planActive)), 6000)
        setMessage({ type: 'warning', text: 'Sua senha atual ainda funciona, mas é mais curta que o padrão de segurança. Para proteger melhor sua conta, recomendamos trocar por uma senha com 8 a 72 caracteres.', action: { label: 'Trocar senha agora', onClick: () => { window.clearTimeout(redirectTimer); setFlow('forgot-email'); setMessage(null) } } })
        return
      }
      window.location.assign(appPathForPlan(data.planActive))
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
      const data = await publicApiFetch('/auth/login/verify-2fa', { method: 'POST', body: JSON.stringify({ code }) })
      window.location.assign(appPathForPlan(data.planActive))
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
      window.location.assign(`/reset-password.html#token=${encodeURIComponent(data.token)}`)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Não foi possível verificar o código.' })
    } finally { setBusy(false) }
  }

  const startReset = async event => {
    event.preventDefault()
    if (!validEmail(email)) return setMessage({ type: 'error', text: 'Informe um e-mail válido.' })
    setBusy(true)
    setMessage(null)
    try {
      const data = await publicApiFetch('/auth/login/forgot-password', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
      setFlow('forgot-sent')
      setMessage({ type: 'success', text: data?.mensagem || 'Se esse e-mail tiver uma conta, enviaremos um link de redefinição.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof ApiError ? error.message : 'Não foi possível enviar o link agora.' })
    } finally {
      setBusy(false)
    }
  }

 const title = register ? 'Criar conta' : flow === 'login-2fa' ? 'Confirmar acesso' : flow === 'forgot-email' ? 'Redefinir senha' : flow === 'forgot-sent' ? 'Verifique seu e-mail' : 'Bem-vindo'

  return <AuthCard>
    <h1 className="auth-title">{title}</h1>
    <p className="auth-subtitle">{register ? 'Crie sua conta para começar a organizar suas redes sociais.' : 'Entre para acessar o gerenciador das suas redes sociais'}</p>
    {register && selectedPlan && <p className="auth-selected-plan">Tier selecionado: <strong>{PLANS[selectedPlan]?.name || selectedPlan}</strong></p>}
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
      <button className="auth-button" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link de redefinição'}</button>
    </form>}

    {flow === 'forgot-sent' && <div className="auth-form">
      <p className="auth-help">Se o endereço <strong>{maskEmail(email)}</strong> estiver cadastrado, enviamos um link para criar uma nova senha. Verifique também a pasta de spam.</p>
      <button type="button" className="auth-button auth-button--secondary" onClick={() => { setFlow('forgot-email'); setMessage(null) }}>Usar outro e-mail</button>
    </div>}

    {flow === 'login' && <>
      <form onSubmit={submitCredentials} className="auth-form">
        {register && <><label className="auth-label" htmlFor="full-name">Nome</label><input id="full-name" className="auth-input" value={fullName} onChange={event => setFullName(event.target.value)} /></>}
        <label className="auth-label" htmlFor="email">E-mail</label>
        <input id="email" className="auth-input" type="email" value={email} onChange={event => setEmail(event.target.value)} required />
        <label className="auth-label" htmlFor="password">Senha</label>
        <input id="password" className="auth-input" type="password" minLength={register ? PASSWORD_MIN_LENGTH : undefined} maxLength="72" value={password} onChange={event => setPassword(event.target.value)} required />
        {register && <p className="auth-help">Use de 8 a 72 caracteres, uma maiúscula, um número e um caractere especial.</p>}
        <button className="auth-button" disabled={busy}>{busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}</button>
      </form>
      {!register && <a className="auth-link auth-forgot" href="#forgot" onClick={event => { event.preventDefault(); setFlow('forgot-email'); setMessage(null) }}>Esqueceu sua senha?</a>}
      <div className="auth-divider"><span>ou</span></div>
      <a className="auth-button auth-button--google" href={`${API_URL}/auth/login/google`}>Continuar com o Google</a>
    </>}

    {flow === 'login' && <p className="auth-switch">{register ? 'Já tem uma conta?' : 'Ainda não tem conta?'} {register ? <button type="button" className="auth-link" onClick={() => { setRegister(false); setFlow('login'); setMessage(null) }}>Entrar</button> : <a className="auth-link" href="/criar-conta">Criar conta</a>}</p>}
    {flow === 'forgot-email' || flow === 'forgot-2fa' || flow === 'forgot-sent' ? <p className="auth-switch"><button type="button" className="auth-link" onClick={() => { setFlow('login'); setMessage(null) }}>Voltar para o login</button></p> : null}
    <p className="auth-legal"><a href="/privacy-policy">Política de Privacidade</a><a href="/terms-of-service">Termos de Uso</a></p>
  </AuthCard>
}

export function CreateAccountPage() {
  const initialPlan = useMemo(() => {
    const plan = new URLSearchParams(window.location.search).get('plan')
    return ACCOUNT_PLANS.some(item => item.id === plan) ? plan : DEFAULT_PLAN
  }, [])
  const [selectedPlan, setSelectedPlan] = useState(initialPlan)
  const [proDiscount, setProDiscount] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState(() => initialPlan === 'premium' ? [...(PLANS.premium.availablePlatforms || PLATFORM_OPTIONS.map(item => item.id))] : [])
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [message, setMessage] = useState(null)
  const plan = ACCOUNT_PLANS.find(item => item.id === selectedPlan) || ACCOUNT_PLANS[0]
  const paidPlan = Number(plan?.priceCents) > 0
  const connectionLimit = plan.maxConnections || PLATFORM_OPTIONS.length
  const availablePlatforms = plan.availablePlatforms || PLATFORM_OPTIONS.map(item => item.id)
  const proDiscountPercent = Number(plan.meuEcooDiscountPercent) || 0
  const selectedPriceCents = Number(plan.priceCents || 0)
  const rules = passwordRules(password)

  useEffect(() => {
    setSelectedPlatforms(current => selectedPlan === 'premium'
      ? [...availablePlatforms]
      : current.filter(platform => availablePlatforms.includes(platform)).slice(0, connectionLimit))
  }, [selectedPlan])

  useEffect(() => {
    window.history.replaceState({}, '', `/criar-conta?plan=${selectedPlan}`)
  }, [selectedPlan])

  function choosePlan(id) {
    setSelectedPlan(id)
    if (id !== 'pro') setProDiscount(false)
    setMessage(null)
  }

  function togglePlatform(platform) {
    if (selectedPlan === 'premium') return
    setSelectedPlatforms(current => current.includes(platform)
      ? current.filter(item => item !== platform)
      : current.length < connectionLimit ? [...current, platform] : current)
    setMessage(null)
  }

  async function submit(event) {
    event.preventDefault()
    if (!fullName.trim()) return setMessage({ type: 'error', text: 'Informe seu nome completo.' })
    if (!validEmail(email)) return setMessage({ type: 'error', text: 'Informe um e-mail válido.' })
    if (!Object.values(rules).every(Boolean)) return setMessage({ type: 'error', text: 'A senha precisa ter de 8 a 72 caracteres, uma maiúscula, um número e um caractere especial.' })
    if (password !== confirmation) return setMessage({ type: 'error', text: 'As senhas não são iguais.' })
    if (selectedPlatforms.length !== connectionLimit) return setMessage({ type: 'error', text: `Selecione exatamente ${connectionLimit} redes sociais antes de continuar.` })
    if (!accepted) return setMessage({ type: 'error', text: 'Aceite os termos para continuar.' })
    setBusy(true)
    setMessage(null)
    try {
      const data = await publicApiFetch('/auth/login/register', { method: 'POST', body: JSON.stringify({ email: email.trim(), password, fullName: fullName.trim(), plan: selectedPlan, selectedPlatforms }) })
      if (data.requiresPayment && data.selectedPlan) {
        const billing = await apiFetch('/api/billing/plan-change', { method: 'POST', body: JSON.stringify({ plan: data.selectedPlan }) })
        if (!billing.checkoutUrl) throw new ApiError('Não foi possível abrir o checkout seguro.')
        window.location.assign(billing.checkoutUrl)
        return
      }
      setComplete(true)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof ApiError ? error.message : 'Não foi possível criar sua conta agora.' })
    } finally { setBusy(false) }
  }

  if (complete) return <main className="checkout-page"><section className="checkout-success"><a className="auth-brand" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/logo.png" alt="Meu Ecoo Mídia" /></a><div className="checkout-success-icon">✓</div><p className="checkout-eyebrow">TUDO PRONTO</p><h1>Conta criada com sucesso</h1><p>Seu cadastro no plano <strong>{plan.name}</strong> foi concluído. Agora você já pode entrar e começar a organizar suas redes.</p><a className="checkout-primary-button" href="/login.html">Entrar na minha conta</a><small>Planos pagos abrem um checkout seguro e só são ativados após a confirmação do gateway.</small><CopyrightNotice /></section></main>

  return <main className="checkout-page">
    <div className="checkout-shell">
      <header className="checkout-header"><a className="checkout-logo" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/logo.png" alt="Meu Ecoo Mídia" /></a><div><span>Já tem uma conta?</span> <a href="/login.html">Entrar</a></div></header>
      <div className="checkout-progress"><span className="is-active">01 <small>Conta</small></span><i /><span className="is-active">02 <small>Plano</small></span><i /><span className="is-active">03 <small>Redes</small></span><i /><span className="is-active">04 <small>Pagamento</small></span></div>
      <div className="checkout-grid">
        <section className="checkout-main">
          <div className="checkout-heading"><p className="checkout-eyebrow">COMECE AGORA</p><h1>Crie sua conta</h1><p>Escolha o plano ideal e tenha tudo para publicar com mais consistência.</p></div>
          <Message message={message} />
          <form onSubmit={submit} className="checkout-form">
            <div className="checkout-section-heading"><span>01</span><div><h2>Seus dados</h2><p>Usaremos essas informações para criar seu acesso.</p></div></div>
            <div className="checkout-fields checkout-fields--two"><label>Nome completo<input className="auth-input" value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name" required placeholder="Como devemos chamar você?" /></label><label>E-mail<input className="auth-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required placeholder="voce@exemplo.com" /></label></div>
            <div className="checkout-fields checkout-fields--two"><label>Senha<input className="auth-input" type="password" minLength="8" maxLength="72" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required placeholder="Crie uma senha segura" /></label><label>Confirmar senha<input className="auth-input" type="password" minLength="8" maxLength="72" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" required placeholder="Repita sua senha" /></label></div>
            <div className="checkout-password-rules">{Object.entries({ length: '8+ caracteres', uppercase: 'Uma maiúscula', number: 'Um número', special: 'Um caractere especial' }).map(([key, label]) => <span key={key} className={rules[key] ? 'is-valid' : ''}>{rules[key] ? '✓' : '○'} {label}</span>)}</div>
            <div className="checkout-section-heading"><span>02</span><div><h2>Escolha seu plano</h2><p>Você pode trocar de plano quando quiser.</p></div></div>
            <div className="checkout-plan-grid">{ACCOUNT_PLANS.map(item => <button type="button" key={item.id} className={`checkout-plan-option${selectedPlan === item.id ? ' is-selected' : ''}${item.featured ? ' is-featured' : ''}`} onClick={() => choosePlan(item.id)}><span className="checkout-plan-check">{selectedPlan === item.id ? '✓' : ''}</span><strong>{item.name}</strong><em>{item.price}<small>/{item.cadence}</small></em><p>{item.description}</p></button>)}</div>
            <p className="checkout-plan-meuecoo">MeuEcoo: {plan.meuEcooOffer}</p>
            {selectedPlan === 'pro' && <fieldset className="checkout-discount-choice"><legend>Benefício do MeuEcoo no Tier 02</legend><label><input type="radio" name="pro-checkout-discount" checked={!proDiscount} onChange={() => setProDiscount(false)} /><span>Pagar o MeuEcoo sem desconto<strong>Assinatura do Tier 02: {formatPlanPrice(plan.priceCents)}/{plan.cadence}</strong></span></label><label><input type="radio" name="pro-checkout-discount" checked={proDiscount} onChange={() => setProDiscount(true)} /><span><b>Pagar o MeuEcoo com {proDiscountPercent}% de desconto</b><strong>Assinatura do Tier 02: {formatPlanPrice(plan.priceCents)}/{plan.cadence}</strong></span></label></fieldset>}
            <div className="checkout-section-heading"><span>03</span><div><h2>Escolha suas redes</h2><p>{selectedPlan === 'premium' ? 'No Premium, as quatro redes sociais já estão liberadas.' : `Selecione exatamente ${connectionLimit} redes. Você poderá conectar até ${connectionLimit} contas no plano.`}</p></div></div>
            <div className="checkout-platform-grid" role="group" aria-label="Redes sociais disponíveis">{PLATFORM_OPTIONS.map(item => { const isSelected = selectedPlatforms.includes(item.id); const isAvailable = availablePlatforms.includes(item.id); const isDisabled = !isAvailable || (selectedPlan !== 'premium' && !isSelected && selectedPlatforms.length >= connectionLimit); return <button type="button" key={item.id} className={`checkout-platform-option${isSelected ? ' is-selected' : ''}${isDisabled ? ' is-disabled' : ''}`} onClick={() => togglePlatform(item.id)} disabled={isDisabled} aria-pressed={isSelected}><span className={`checkout-platform-symbol checkout-platform-symbol--${item.id}`}><PlatformIcon platform={item.id} className="checkout-platform-svg" /></span><span><strong>{item.label}</strong><small>{isSelected ? 'Liberada no seu plano' : selectedPlan === 'premium' ? 'Incluída no Premium' : 'Selecionar'}</small></span><b>{isSelected ? '✓' : ''}</b></button> })}</div>
            <p className="checkout-platform-count">{selectedPlatforms.length} de {connectionLimit} redes selecionadas</p>
            <div className="checkout-section-heading"><span>04</span><div><h2>Pagamento seguro</h2><p>Você será levado ao checkout hospedado do gateway depois de criar a conta.</p></div></div>
            <div className="checkout-pix-box"><strong>Checkout protegido</strong><p>Os dados de pagamento são informados diretamente no gateway. O aplicativo não recebe nem armazena número de cartão, validade ou CVV.</p><span>✓ Uma cobrança por usuário no mês</span></div>
            <label className="checkout-terms"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> <span>Li e aceito a <a href="/privacy-policy" target="_blank" rel="noreferrer">Política de Privacidade</a> e os <a href="/terms-of-service" target="_blank" rel="noreferrer">Termos de Uso</a>.</span></label>
            <button className="checkout-submit" disabled={busy}>{busy ? 'Criando sua conta…' : paidPlan ? 'Criar conta e ir ao pagamento' : 'Continuar'} <span>→</span></button>
            <p className="checkout-security">⌁ Cadastro protegido · Não armazenamos dados sensíveis do cartão</p>
          </form>
        </section>
        <aside className="checkout-summary"><div className="checkout-summary-top"><p className="checkout-eyebrow">SEU PLANO</p><span className="checkout-summary-badge">{plan.featured ? 'Mais escolhido' : 'Escolha flexível'}</span></div><h2>{plan.name}</h2><p>{plan.description}</p><p className="checkout-plan-meuecoo">{plan.meuEcooOffer}</p><div className="checkout-summary-price"><strong>{formatPlanPrice(selectedPriceCents)}</strong><span>/{plan.cadence}</span></div>{selectedPlan === 'pro' && <p className="checkout-summary-discount">MeuEcoo: {proDiscount ? `${proDiscountPercent}% de desconto` : 'sem oferta'}</p>}<ul>{plan.features.map(feature => <li key={feature}>✓ <span>{feature}</span></li>)}</ul><div className="checkout-summary-note"><span>✦</span><p><strong>Feito para você publicar melhor</strong><br />Comece simples e evolua no seu ritmo.</p></div><a href="#planos" onClick={event => { event.preventDefault(); document.querySelector('.checkout-plan-grid')?.scrollIntoView({ behavior: 'smooth' }) }}>Comparar outros planos</a></aside>
      </div>
      <footer className="checkout-footer"><CopyrightNotice /></footer>
    </div>
  </main>
}

export function ResetPasswordPage() {
  const token = useMemo(() => {
    const hashToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
    const queryToken = new URLSearchParams(window.location.search).get('token')
    const value = hashToken || queryToken
    if (hashToken) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
    return value
  }, [])
  const [valid, setValid] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const rules = passwordRules(password)

  useEffect(() => {
    if (!token) return setValid(false)
    publicApiFetch('/auth/login/reset-password/validar', { method: 'POST', body: JSON.stringify({ token }) }).then(data => setValid(data.valido)).catch(() => setValid(false))
  }, [token])

  const submit = async event => {
    event.preventDefault()
    if (!Object.values(rules).every(Boolean)) return setMessage({ type: 'error', text: 'A senha precisa ter de 8 a 72 caracteres, uma maiúscula, um número e um caractere especial.' })
    if (password !== confirmation) return setMessage({ type: 'error', text: 'As senhas não são iguais.' })
    setBusy(true)
    try {
      await publicApiFetch('/auth/login/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) })
      setMessage({ type: 'success', text: 'Senha redefinida com sucesso! Redirecionando para o login…' })
      setTimeout(() => window.location.assign('/login.html'), 1800)
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Não foi possível redefinir sua senha.' }) }
    finally { setBusy(false) }
  }

  return <AuthCard><h1 className="auth-title">Criar nova senha</h1><p className="auth-subtitle">{valid === null ? 'Verificando seu link…' : valid ? 'Escolha uma nova senha para acessar sua conta.' : 'Esse link não é mais válido ou já expirou.'}</p><Message message={message} />{valid && <form onSubmit={submit} className="auth-form"><label className="auth-label" htmlFor="new-password">Nova senha</label><input id="new-password" className="auth-input" type="password" minLength={PASSWORD_MIN_LENGTH} maxLength="72" value={password} onChange={event => setPassword(event.target.value)} autoFocus required /><div className="auth-rules">{Object.entries({ length: '8 a 72 caracteres', uppercase: '1 letra maiúscula', number: '1 número', special: '1 caractere especial' }).map(([key, label]) => <span key={key} className={rules[key] ? 'is-valid' : ''}>{rules[key] ? '✓' : '○'} {label}</span>)}</div><label className="auth-label" htmlFor="confirm-password">Confirme a nova senha</label><input id="confirm-password" className="auth-input" type="password" minLength={PASSWORD_MIN_LENGTH} maxLength="72" value={confirmation} onChange={event => setConfirmation(event.target.value)} required /><button className="auth-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button></form>}<p className="auth-switch"><a className="auth-link" href="/login.html">Voltar para o login</a></p></AuthCard>
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
