import { useEffect, useState } from 'react'
import { apiFetch, logout } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useToast } from '../components/ui/toast.jsx'
import { getTutorialStatus, requestTutorialOpen, TUTORIAL_STATUS_EVENT } from '../lib/tutorial.js'
import { DEFAULT_PLAN, PLANS, getPlan, normalizePlan } from '../lib/plans.js'

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const DEFAULT_NOTIFICATIONS = { email: true, published: true, failures: true, comments: true }
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }

function initials(profile) {
  const label = profile?.fullName || profile?.email || 'U'
  return label.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
}

function formatDate(value) {
  if (!value) return 'Não informado'
  return new Date(value).toLocaleDateString('pt-BR', { dateStyle: 'long' })
}

export function ProfilePage({ user, onNavigate, onUserChange }) {
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ fullName: user?.fullName || '', timezone: 'America/Sao_Paulo', language: 'pt-BR', defaultPlatform: '', notificationPreferences: DEFAULT_NOTIFICATIONS })
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmation: '' })
  const [usage, setUsage] = useState(null)
  const [billing, setBilling] = useState(null)
  const [billingBusy, setBillingBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [error, setError] = useState('')
  const [tutorialStatus, setTutorialStatus] = useState(() => getTutorialStatus())
  const notify = useToast()

  useEffect(() => {
    const handleStatusChange = event => setTutorialStatus(event.detail || getTutorialStatus())
    window.addEventListener(TUTORIAL_STATUS_EVENT, handleStatusChange)
    return () => window.removeEventListener(TUTORIAL_STATUS_EVENT, handleStatusChange)
  }, [])

  useEffect(() => {
    Promise.all([
      apiFetch('/api/me/profile'),
      apiFetch('/api/ai/demo-status').catch(() => null),
      apiFetch('/api/billing/status').catch(() => null)
    ]).then(([data, aiUsage, billingStatus]) => {
      setProfile(data)
      setForm({
        fullName: data.fullName || '',
        timezone: data.timezone || 'America/Sao_Paulo',
        language: data.language || 'pt-BR',
        defaultPlatform: data.defaultPlatform || '',
        notificationPreferences: { ...DEFAULT_NOTIFICATIONS, ...(data.notificationPreferences || {}) }
      })
      setUsage(aiUsage)
      setBilling(billingStatus)
    }).catch(caught => setError(caught.message)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!billing || new URLSearchParams(window.location.search).get('billing') !== 'success') return undefined
    window.history.replaceState({}, '', window.location.pathname)
    if (billing.charge?.status === 'paid') return undefined

    let active = true
    let attempts = 0
    let timer = null
    const poll = async () => {
      attempts += 1
      const status = await apiFetch('/api/billing/status').catch(() => null)
      if (!active) return
      if (status) setBilling(status)
      if (status?.charge?.status !== 'paid' && attempts < 6) timer = window.setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [billing])

  function updateForm(key, value) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function updateNotification(key, value) {
    setForm(current => ({ ...current, notificationPreferences: { ...current.notificationPreferences, [key]: value } }))
  }

  async function saveProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const data = await apiFetch('/api/me/profile', { method: 'PATCH', body: JSON.stringify(form) })
      setProfile(data)
      setForm(current => ({ ...current, notificationPreferences: data.notificationPreferences || current.notificationPreferences }))
      onUserChange?.({ fullName: data.fullName })
      notify('Perfil e preferências salvos.')
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally { setSaving(false) }
  }

  async function changePassword(event) {
    event.preventDefault()
    if (password.newPassword !== password.confirmation) return setError('A confirmação da nova senha não confere.')
    setPasswordSaving(true)
    setError('')
    try {
      await apiFetch('/api/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: password.currentPassword, newPassword: password.newPassword }) })
      setPassword({ currentPassword: '', newPassword: '', confirmation: '' })
      notify('Senha alterada com sucesso.')
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally { setPasswordSaving(false) }
  }

  async function changeAvatar(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return notify('Escolha uma imagem JPG, PNG, GIF ou WebP.', 'error')
    setAvatarSaving(true)
    try {
      const upload = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
      const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!response.ok) throw new Error('Não foi possível enviar a imagem.')
      const uploaded = await response.json().catch(() => null)
      const avatarUrl = upload.mediaUrl || uploaded?.url
      if (!avatarUrl) throw new Error('O upload não retornou uma URL válida.')
      await apiFetch('/api/me/avatar', { method: 'POST', body: JSON.stringify({ avatarUrl }) })
      setProfile(current => ({ ...current, avatarUrl }))
      onUserChange?.({ avatarUrl })
      notify('Foto de perfil atualizada.')
    } catch (caught) { notify(caught.message, 'error') }
    finally { setAvatarSaving(false) }
  }

  async function removeAvatar() {
    setAvatarSaving(true)
    try {
      await apiFetch('/api/me/avatar', { method: 'POST', body: JSON.stringify({ avatarUrl: null }) })
      setProfile(current => ({ ...current, avatarUrl: null }))
      onUserChange?.({ avatarUrl: null })
      notify('Foto de perfil removida.')
    } catch (caught) { notify(caught.message, 'error') }
    finally { setAvatarSaving(false) }
  }

  async function logoutAll() {
    if (!window.confirm('Isso encerrará todas as sessões desta conta. Deseja continuar?')) return
    try {
      await apiFetch('/api/me/logout-all', { method: 'POST' })
      logout()
    } catch (caught) { notify(caught.message, 'error') }
  }

  async function choosePlan(planId) {
    const currentPlanId = normalizePlan(profile?.plan || user?.plan || DEFAULT_PLAN)
    const target = PLANS[planId]
    if (!target || planId === currentPlanId) return
    if (Number(target.priceCents) > 0 && !window.confirm(`A troca para o plano ${target.name} abrirá o checkout seguro e poderá gerar uma única cobrança neste mês. Continuar?`)) return

    setBillingBusy(true)
    try {
      const result = await apiFetch('/api/billing/plan-change', { method: 'POST', body: JSON.stringify({ plan: planId }) })
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl)
        return
      }
      if (result.plan) {
        setProfile(current => ({ ...current, plan: result.plan }))
        onUserChange?.({ plan: result.plan })
      }
      const status = await apiFetch('/api/billing/status').catch(() => null)
      if (status) setBilling(status)
      notify(result.status === 'updated' ? 'Plano atualizado com sucesso.' : 'Solicitação de troca registrada.')
    } catch (caught) {
      notify(caught.message || 'Não foi possível trocar o plano agora.', 'error')
    } finally { setBillingBusy(false) }
  }

  if (loading) return <section className="page-view profile-page"><section className="panel"><p className="empty-state">Carregando seu perfil...</p></section></section>

  const current = profile || user || {}
  const notifications = form.notificationPreferences || DEFAULT_NOTIFICATIONS
  const avatar = current.avatarUrl
  const currentPlanId = normalizePlan(current.plan || DEFAULT_PLAN)
  const currentPlan = getPlan(currentPlanId)
  const chargeStatusMessage = billing?.charge?.status === 'paid'
    ? 'Cobrança deste mês confirmada.'
    : billing?.charge?.status === 'processing'
      ? 'Pagamento em processamento. O plano será ativado após a confirmação do gateway.'
      : billing?.charge?.status === 'failed'
        ? 'A tentativa deste mês não foi concluída. Uma nova cobrança não será criada automaticamente.'
      : billing?.charge?.status === 'pending'
          ? 'Checkout pendente. Finalize o pagamento para ativar o plano escolhido.'
          : billing?.charge?.status === 'cancelled'
            ? 'O checkout anterior foi cancelado. Não será criada outra cobrança neste mês.'
          : ''

  return <section className="page-view profile-page"><section className="panel profile-panel">
    <div className="profile-heading"><div><p className="eyebrow">MINHA CONTA</p><h2>Meu perfil</h2><p className="panel-subtitle">Gerencie seus dados, preferências e segurança em um só lugar.</p></div><span className="profile-role-badge">{current.role === 'super_admin' ? 'Super administrador' : current.role === 'admin' ? 'Administrador' : 'Usuário'}</span></div>
    {error && <p className="error-message" role="alert">{error}</p>}

    <div className="profile-identity-card">
      <span className="profile-large-avatar">{avatar ? <img src={avatar} alt="Foto do perfil" /> : initials(current)}</span>
      <div className="profile-identity-copy"><strong>{current.fullName || 'Seu nome'}</strong><span>{current.email}</span><small>Conta criada em {formatDate(current.createdAt)}</small></div>
      <div className="profile-avatar-actions"><label className="secondary-button profile-upload-button">{avatarSaving ? 'Enviando…' : 'Alterar foto'}<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={changeAvatar} disabled={avatarSaving} /></label>{avatar && <button type="button" className="link-button danger-link" onClick={removeAvatar} disabled={avatarSaving}>Remover</button>}</div>
    </div>

    <form className="profile-section profile-form" onSubmit={saveProfile}>
      <div className="profile-section-heading"><div><p className="eyebrow">DADOS E PREFERÊNCIAS</p><h3>Configurações gerais</h3></div><button type="submit" className="action-button" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></div>
      <div className="profile-fields">
        <label>Nome completo<input value={form.fullName} onChange={event => updateForm('fullName', event.target.value)} maxLength={255} placeholder="Como você quer ser chamado" /></label>
        <label>E-mail<input value={current.email || ''} disabled /></label>
        <label>Idioma<select value={form.language} onChange={event => updateForm('language', event.target.value)}><option value="pt-BR">Português (Brasil)</option><option value="en-US">English (United States)</option></select></label>
        <label>Fuso horário<select value={form.timezone} onChange={event => updateForm('timezone', event.target.value)}><option value="America/Sao_Paulo">Brasília (GMT-3)</option><option value="America/Manaus">Manaus (GMT-4)</option><option value="America/Belem">Belém (GMT-3)</option><option value="UTC">UTC</option></select></label>
        <label>Rede padrão para publicar<select value={form.defaultPlatform} onChange={event => updateForm('defaultPlatform', event.target.value)}><option value="">Escolher depois</option>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      </div>
      <div className="profile-preference-group"><strong>Notificações</strong><span>Escolha quais atualizações devem aparecer para você.</span><div className="profile-toggle-list">{[['published', 'Publicações concluídas'], ['failures', 'Falhas de publicação'], ['comments', 'Novos comentários'], ['email', 'Avisos importantes por e-mail']].map(([key, label]) => <label className="profile-toggle" key={key}><span><strong>{label}</strong><small>{key === 'comments' ? 'Acompanhe as interações da sua comunidade.' : 'Receba atualizações relevantes do sistema.'}</small></span><input type="checkbox" checked={Boolean(notifications[key])} onChange={event => updateNotification(key, event.target.checked)} /></label>)}</div></div>
    </form>

    <div className="profile-columns">
      <section className="profile-section"><div className="profile-section-heading"><div><p className="eyebrow">SEGURANÇA</p><h3>Proteja sua conta</h3></div><span className={`profile-status-dot${current.totpEnabled ? ' is-on' : ''}`}>{current.totpEnabled ? 'Ativo' : 'Recomendado'}</span></div><div className="profile-security-row"><span className="profile-card-icon">⌁</span><div><strong>Autenticação em 2 fatores</strong><small>{current.totpEnabled ? 'Sua conta pede um código extra no login.' : 'Adicione uma camada extra de proteção.'}</small></div><button type="button" className="link-button" onClick={() => onNavigate?.('seguranca')}>{current.totpEnabled ? 'Gerenciar' : 'Configurar'}</button></div><form className="profile-password-form" onSubmit={changePassword}><h4>Alterar senha</h4><label>Senha atual<input type="password" value={password.currentPassword} onChange={event => setPassword(current => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" placeholder="Digite sua senha atual" /></label><label>Nova senha<input type="password" value={password.newPassword} onChange={event => setPassword(current => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" placeholder="Mínimo de 6 caracteres" /></label><label>Confirmar nova senha<input type="password" value={password.confirmation} onChange={event => setPassword(current => ({ ...current, confirmation: event.target.value }))} autoComplete="new-password" placeholder="Repita a nova senha" /></label><button type="submit" className="secondary-button" disabled={passwordSaving}>{passwordSaving ? 'Alterando…' : 'Alterar senha'}</button></form></section>
       <section className="profile-section"><div className="profile-section-heading"><div><p className="eyebrow">USO DA APLICAÇÃO</p><h3>Seu plano e consumo</h3></div><span className="profile-status-dot is-on">Ativo</span></div><div className="profile-usage-card"><span className="profile-card-icon">✦</span><div><strong>Plano atual: {currentPlan.name}</strong><small>Gerações de IA incluídas no limite diário do aplicativo.</small></div><b>{usage ? `${usage.restantes}/${usage.limite}` : '—'}</b></div>{chargeStatusMessage && <p className="profile-billing-note" role="status">{chargeStatusMessage}</p>}<div className="profile-plan-options" aria-label="Escolha seu plano">{Object.values(PLANS).map(planOption => <article key={planOption.id} className={`profile-plan-option${currentPlanId === planOption.id ? ' is-current' : ''}`}><div><strong>{planOption.name}</strong><small>{planOption.checkoutPrice === 'R$ 0' ? 'Grátis' : `${planOption.checkoutPrice}/${planOption.cadence}`}</small></div><p>{planOption.description}</p><button type="button" className={currentPlanId === planOption.id ? 'secondary-button' : 'action-button'} onClick={() => choosePlan(planOption.id)} disabled={billingBusy || currentPlanId === planOption.id}>{currentPlanId === planOption.id ? 'Plano atual' : billingBusy ? 'Processando…' : 'Escolher plano'}</button></article>)}</div><p className="profile-help-text">Uma troca para plano pago abre o checkout seguro e só ativa o plano após a confirmação do gateway. O sistema limita a uma cobrança por usuário no mês.</p><div className="profile-quick-links"><button type="button" onClick={() => onNavigate?.('integracoes')}>Gerenciar contas <span>→</span></button><button type="button" onClick={() => onNavigate?.('tokens')}>Ver tokens <span>→</span></button><button type="button" onClick={() => onNavigate?.('atividade')}>Abrir histórico de atividades <span>→</span></button></div></section>
    </div>

    <section className="profile-section"><div className="profile-section-heading"><div><p className="eyebrow">AJUDA</p><h3>Tutorial guiado</h3></div><span className={`profile-status-dot${tutorialStatus.completed ? ' is-on' : ''}`}>{tutorialStatus.completed ? 'Concluído' : 'Pendente'}</span></div><div className="tutorial-status-card"><span className={`tutorial-status-check${tutorialStatus.completed ? ' is-done' : ''}`} aria-hidden="true">{tutorialStatus.completed ? '✓' : '○'}</span><div><strong>{tutorialStatus.completed ? 'Você já completou o tutorial' : 'Você ainda não completou o tutorial'}</strong><small>{tutorialStatus.completed && tutorialStatus.completedAt ? `Concluído em ${formatDateTime(tutorialStatus.completedAt)}. Pode rever quando quiser.` : 'Um tour rápido pelas principais telas da plataforma.'}</small></div><button type="button" className="link-button" onClick={requestTutorialOpen}>{tutorialStatus.completed ? 'Rever tutorial' : 'Iniciar tutorial'}</button></div></section>

    <section className="profile-section profile-session-section"><div className="profile-section-heading"><div><p className="eyebrow">SESSÕES E DISPOSITIVOS</p><h3>Sessão atual</h3></div><span className="profile-status-dot is-on">Conectado</span></div><div className="profile-session-row"><span className="profile-card-icon">⌘</span><div><strong>Navegador atual</strong><small>Esta sessão usa um token seguro e permanece ativa por até 30 dias.</small></div><button type="button" className="link-button danger-link" onClick={logout}>Sair desta conta</button></div><div className="profile-session-actions"><p>Se você acessou a conta em outro computador, encerre todas as sessões por segurança.</p><button type="button" className="secondary-button" onClick={logoutAll}>Sair de todos os dispositivos</button></div></section>

    <footer className="profile-footer-links"><span>Precisa de ajuda?</span><a href="/support">Suporte</a><a href="/privacy-policy">Política de privacidade</a><a href="/terms-of-service">Termos de serviço</a></footer>
  </section></section>
}
