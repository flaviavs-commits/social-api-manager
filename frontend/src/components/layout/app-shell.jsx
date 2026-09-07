import { useEffect, useRef, useState } from 'react'
import { AiAssistantWidget } from '../ai/ai-assistant-widget.jsx'
import { apiFetch, logout } from '../../lib/api.js'
import { ToastProvider, useToast } from '../ui/toast.jsx'
import { ThemeSelector } from '../ui/theme-selector.jsx'
import { AppTutorial } from '../ui/app-tutorial.jsx'
import { getTutorialStatus, markTutorialCompleted, markTutorialSeen, TUTORIAL_OPEN_EVENT } from '../../lib/tutorial.js'
import { getPlan, hasActivePlanModule } from '../../lib/plans.js'
import { CopyrightNotice } from '../ui/copyright-notice.jsx'
import { TEAM_APPROVAL_UI_ENABLED } from '../../lib/feature-flags.js'

const icons = {
  dashboard: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 7h7v9h-7v-9ZM4 14h7v6H4v-6Z',
  agendador: 'M4 20h4.2L18.8 9.4l-4.2-4.2L4.4 15.8 4 20Zm12.5-14.7 2.2 2.2 1.6-1.6a1.5 1.5 0 0 0 0-2.1l-.1-.1a1.5 1.5 0 0 0-2.1 0l-1.6 1.6Z',
  calendario: 'M7 2v3M17 2v3M3.5 8.5h17M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 7h3v3H7v-3Z',
  rascunhos: 'M6 2h9l3 3v17H6V2Zm8 1v4h4M9 12h6M9 15.5h6M9 8.5h3',
  analytics: 'M4 20V10M10 20V4M16 20v-7M22 20v-3',
  inbox: 'M3 5h18l-1.5 12a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8L3 5Zm0 0 2.5 7h13L21 5M9.5 12h5',
  integracoes: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-7 9a7 7 0 0 1 14 0',
  tokens: 'M15 7a4 4 0 1 1-4 4H4v2h2v3h3v-3h2.06A4 4 0 0 0 15 7Zm0-2a6 6 0 1 1-5.92 7H7v3H4v-3H2v-4h7.08A6 6 0 0 1 15 5Z',
  seguranca: 'M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Zm0 5v4m0 4h.01',
  atividade: 'M4 5h16M4 12h16M4 19h10',
  ai: 'M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3ZM12 8V5m-2 0h4M8 12h.01M16 12h.01M9 16h6M3 13h2m14 0h2',
  biblioteca: 'M4 5h16v14H4V5Zm4 0v14m-4-4h4m8-6h4m-4 3h4',
  filas: 'M5 4h14v16H5V4Zm3 0v3m8-3v3M8 11h8M8 15h5'
  ,smartlinks: 'M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1l-.8.8m3.4 5.4a5 5 0 0 0-7.1-.1l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8',
  equipe: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm9 2v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
}

const navigation = [
  ['dashboard', 'Dashboard'],
  ['agendador', 'Meu Post'],
  ['calendario', 'Calendário'],
  ['rascunhos', 'Baú de Ideias'],
  ['analytics', 'Relatórios'],
  ['inbox', 'Inbox'],
  ['integracoes', 'Contas'],
  ['seguranca', 'Segurança'],
  ['atividade', 'Atividades'],
  ['ai', 'Assistente IA'],
  ['biblioteca', 'Biblioteca'],
  ['filas', 'Repetidor de posts']
  ,['smartlinks', 'Smartlinks']
  ,['equipe', 'Equipe']
].filter(([key]) => key !== 'equipe' || TEAM_APPROVAL_UI_ENABLED)

const navigationGroups = [
  ['Principal', navigation.slice(0, 3)],
  ['Seu espaço', navigation.slice(3)],
]

function NavIcon({ name, className = 'h-[18px] w-[18px]' }) {
  const d = icons[name]
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function AppSidebar({ page, open, onNavigate, onClose, user, collapsed, onToggleCollapsed }) {
  return (
    <>
    <aside
      className={`app-sidebar sidebar fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-subtle bg-surface transition-transform duration-200 md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}${collapsed ? ' is-collapsed' : ''}`}
    >
      <div className="sidebar-header">
        <button type="button" className="sidebar-collapse-button" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu'}><span aria-hidden="true">☰</span><span className="sidebar-collapse-label">{collapsed ? 'Expandir' : 'Recolher'}</span></button>
        <a href="/app/dashboard" onClick={event => { event.preventDefault(); onNavigate('dashboard') }} aria-label="Meu Ecoo Mídia - ir para o dashboard" className="sidebar-brand group flex flex-col items-center gap-2 text-center">
          <img src="/logo.png" alt="Meu Ecoo Mídia" className="h-14 w-auto" />
          <p className="sidebar-tagline truncate text-[11px] leading-tight text-zinc-500">Conecte. Crie. Agende. Cresça.</p>
        </a>
      </div>

      <nav aria-label="Navegação principal" className="sidebar-navigation flex flex-1 flex-col gap-1 px-3 py-4">
        {navigationGroups.map(([groupLabel, groupItems], groupIndex) => (
          <div className={`sidebar-nav-group${groupIndex ? ' sidebar-nav-group-separated' : ''}`} key={groupLabel}>
            <h2 className="sidebar-nav-group-label">{groupLabel}</h2>
            {groupItems.map(([key, label]) => {
              const active = page === key
              const locked = user && !hasActivePlanModule(user.plan, key, user.planActive, user.planUnrestricted)
              return (
                <button
                  key={key}
                  data-tutorial-target={key}
                  onClick={() => onNavigate(key)}
                  title={collapsed ? label : undefined}
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex items-center justify-between rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition-colors ${locked ? 'opacity-60' : ''} ${
                    active
                      ? 'border-gold bg-gold/10 text-gold'
                      : 'border-transparent text-zinc-400 hover:bg-surface-soft hover:text-zinc-100'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <NavIcon name={key} />
                    <span className="sidebar-nav-label">{label}</span>
                  </span>
                  {(active || locked) && (
                    <span className={`sidebar-active-label rounded-full px-2 py-0.5 text-[11px] font-semibold ${locked ? 'bg-gold/10 text-gold' : 'bg-green-500/10 text-green-500'}`}>
                      {locked ? 'Plano' : 'Ativo'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-legal-links mx-3 mb-3 border-t border-subtle pt-3">
        <a href="/privacy-policy" className="block rounded px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:text-gold">Política de Privacidade</a>
        <a href="/terms-of-service" className="block rounded px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:text-gold">Termos de Serviço</a>
      </div>

      {(userIsAdmin(user)) && <a
        href="/admin.html"
        title="Administração"
        data-tutorial-target="administracao"
        className="mx-3 mb-3 rounded-lg border border-subtle px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-gold/40 hover:text-gold"
      >
        Administração
      </a>}

      <button
        onClick={logout}
        title="Sair"
        className="sidebar-logout mx-3 mb-5 rounded-lg border border-subtle px-3 py-2.5 text-left text-sm font-medium text-zinc-400 transition-colors hover:border-gold/40 hover:text-gold"
      >
        Sair
      </button>
    </aside>
    {open && <button aria-label="Fechar menu" onClick={onClose} className="fixed inset-0 z-30 bg-black/60 md:hidden" />}
    </>
  )
}

function MobileBottomNav({ page, onNavigate, onOpenMenu }) {
  const items = [
    ['dashboard', 'Início'],
    ['agendador', 'Criar'],
    ['calendario', 'Agenda'],
    ['inbox', 'Inbox'],
  ]
  return <nav className="mobile-bottom-nav md:hidden" aria-label="Ações principais">
    {items.map(([key, label]) => <button key={key} type="button" data-tutorial-target={key} className={page === key ? 'is-active' : ''} aria-current={page === key ? 'page' : undefined} onClick={() => onNavigate(key)}><NavIcon name={key} className="h-5 w-5"/><span>{label}</span></button>)}
    <button type="button" onClick={onOpenMenu}><span className="mobile-more-icon" aria-hidden="true">•••</span><span>Mais</span></button>
  </nav>
}

function userIsAdmin(user) {
  return user?.role === 'admin'
}

function notificationKind(item) {
  const message = String(item?.message || '').toLowerCase()
  if (item?.type === 'err') return 'error'
  if (item?.type === 'warn') return 'warning'
  if (/falhou|falha|não foi possível|não conseguiu|erro/.test(message)) return 'error'
  if (/aguardando|processando|pendente|enviado para/.test(message)) return 'pending'
  if (/parcial|atenção/.test(message)) return 'warning'
  return item?.type === 'ok' ? 'success' : 'info'
}

const NOTIFICATION_KIND_LABELS = { success: 'Sucesso', error: 'Erro', pending: 'Em processamento', warning: 'Atenção', info: 'Atualização' }
const NOTIFICATION_POLL_INTERVAL_MS = 60 * 1000

function isPublicationNotification(item) {
  return /^post #\d+\s+(?:publicado com sucesso|publicado parcialmente|falhou ao publicar)/.test(String(item?.message || '').toLowerCase())
}

function isCommentNotification(item) {
  return /^novo comentário de @/i.test(String(item?.message || ''))
}

function isBellNotification(item) {
  return isPublicationNotification(item) || isCommentNotification(item)
}

function mergeNotifications(current, incoming) {
  const byId = new Map()
  ;[...incoming, ...current].forEach(item => byId.set(item.id, item))
  return [...byId.values()]
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    .slice(0, 5)
}

function notificationPreferenceEnabled(item, user) {
  const preferences = user?.notificationPreferences || {}
  if (isCommentNotification(item)) return preferences.comments !== false
  const kind = notificationKind(item)
  if (kind === 'success') return preferences.published !== false
  if (kind === 'warning' || kind === 'error') return preferences.failures !== false
  return true
}

function AppTopbar({ currentLabel, user, onOpenSidebar, sidebarOpen, onCreatePost, onNavigate, onOpenShortcutHelp, onOpenTutorial }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const notificationCursor = useRef(0)
  const notificationPolling = useRef(false)
  const notificationsInitialized = useRef(false)
  const notify = useToast()

  useEffect(() => {
    let active = true
    notificationsInitialized.current = false

    async function primeNotifications() {
      if (!active || notificationPolling.current) return
      notificationPolling.current = true
      let primed = false
      try {
        const result = await apiFetch('/api/logs?limit=30')
        const logs = result.logs || []
        if (!active) return
        notificationCursor.current = Math.max(0, ...logs.map(item => Number(item.id) || 0))
        setNotifications(logs.filter(isBellNotification).slice(0, 5))
        primed = true
      } catch {
        // A falha no polling não deve bloquear a navegação do painel.
      } finally {
        if (active) notificationsInitialized.current = primed
        notificationPolling.current = false
      }
    }

    async function pollNotifications() {
      if (!active || !notificationsInitialized.current || notificationPolling.current) return
      notificationPolling.current = true
      try {
        // A consulta também funciona fora do Inbox e faz o backend descobrir
        // comentários novos para transformá-los em notificações do sininho.
        await apiFetch('/api/posts/inbox/unread').catch(() => {})
        const result = await apiFetch(`/api/logs/since/${notificationCursor.current}`)
        const logs = result.logs || []
        if (logs.length) notificationCursor.current = Math.max(notificationCursor.current, ...logs.map(item => Number(item.id) || 0))
        const bellLogs = logs.filter(isBellNotification)
        if (!active || !bellLogs.length) return

        setNotifications(current => mergeNotifications(current, bellLogs))
        const visibleNotifications = bellLogs.filter(item => notificationPreferenceEnabled(item, user))
        if (!visibleNotifications.length) return
        setUnreadNotifications(current => current + visibleNotifications.length)
        visibleNotifications.forEach(item => {
          const kind = notificationKind(item)
          notify(item.message, kind === 'error' ? 'error' : kind === 'warning' ? 'warning' : 'success')
        })
      } catch {
        // Mantém o cursor para tentar novamente no próximo intervalo.
      } finally {
        notificationPolling.current = false
      }
    }

    primeNotifications()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      if (notificationsInitialized.current) pollNotifications()
      else primeNotifications()
    }, NOTIFICATION_POLL_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [notify, user])

  async function toggleNotifications() {
    const nextOpen = !notificationsOpen
    setNotificationsOpen(nextOpen)
    if (!nextOpen) return
    setUnreadNotifications(0)
    setNotificationsLoading(true)
    try {
      const result = await apiFetch('/api/logs?limit=30')
      setNotifications((result.logs || []).filter(isBellNotification).slice(0, 5))
    } catch {
      setNotifications([])
    } finally {
      setNotificationsLoading(false)
    }
  }

  return (
    <header className="app-topbar-modern flex items-center justify-between gap-4 border-b border-subtle bg-app px-6 py-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={sidebarOpen}
          className="app-mobile-menu-button rounded-lg border border-subtle p-2 text-zinc-400 hover:text-gold"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <nav aria-label="Página atual" className="flex min-w-0 items-center text-xl font-semibold text-zinc-50">
          <span className="truncate text-base text-gold sm:text-lg">{currentLabel}</span>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <ThemeSelector />
        <button type="button" aria-label="Rever o tutorial guiado" title="Rever o tutorial guiado" onClick={onOpenTutorial} className="tutorial-trigger topbar-text-action hidden h-9 items-center justify-center gap-1.5 rounded-lg border border-subtle px-2.5 text-sm font-semibold text-zinc-500 transition-colors hover:border-gold/40 hover:text-gold sm:flex"><span aria-hidden="true">🎓</span><span>Tutorial</span></button>
        <button type="button" aria-label="Ver atalhos de teclado" title="Ver atalhos de teclado" onClick={onOpenShortcutHelp} className="topbar-shortcuts-button topbar-text-action hidden h-9 items-center justify-center gap-1.5 rounded-lg border border-subtle px-2.5 text-sm font-semibold text-zinc-500 transition-colors hover:border-gold/40 hover:text-gold sm:flex"><span aria-hidden="true">?</span><span>Atalhos</span></button>
        <button aria-label="Abrir mensagens" title="Abrir mensagens" onClick={() => onNavigate('inbox')} className="topbar-icon-button topbar-labeled-action rounded-full p-2 text-zinc-400 transition-colors hover:bg-surface-soft hover:text-gold">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9Z"/></svg>
          <span className="topbar-action-label">Mensagens</span>
        </button>
        <div className="notification-control">
          <button aria-label="Abrir notificações" title="Abrir notificações" data-tutorial-target="notificacoes" aria-expanded={notificationsOpen} onClick={toggleNotifications} className="topbar-icon-button topbar-labeled-action rounded-full p-2 text-zinc-400 transition-colors hover:bg-surface-soft hover:text-gold">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/></svg>
            <span className="topbar-action-label">Notificações</span>
            {unreadNotifications > 0 && <span className="notification-dot" aria-label={`${unreadNotifications} notificações novas`} />}
          </button>
          {notificationsOpen && <div className="notification-popover" role="dialog" aria-label="Notificações recentes">
            <div className="notification-popover-heading"><strong>Notificações</strong><span>Recentes</span></div>
            {notificationsLoading
              ? <p className="notification-empty">Carregando atualizações...</p>
              : notifications.length
                ? <div className="notification-list">{notifications.map(item => { const kind = notificationKind(item); const comment = isCommentNotification(item); return <div className={`notification-item notification-item-${kind}${comment ? ' notification-item-comment' : ''}`} key={item.id}><span className={`notification-mark notification-mark-${kind}`} aria-hidden="true">{comment ? '💬' : kind === 'error' ? '!' : kind === 'pending' ? '…' : kind === 'warning' ? '!' : '✓'}</span><div><span className={`notification-status-label notification-status-${kind}`}>{comment ? 'Novo comentário' : NOTIFICATION_KIND_LABELS[kind]}</span><p>{item.message}</p><small>{item.timestamp ? new Date(item.timestamp).toLocaleString('pt-BR') : 'Agora'}</small></div></div>})}</div>
                : <p className="notification-empty">Nenhuma atualização recente.</p>}
            <button type="button" className="notification-see-all" onClick={() => { setNotificationsOpen(false); onNavigate('atividade') }}>Ver histórico completo</button>
          </div>}
        </div>
        <button
          onClick={onCreatePost}
          data-tutorial-target="criar-post"
          aria-label="+ Criar Novo Post"
          title="+ Criar Novo Post"
          className="create-post-button inline-flex items-center gap-2 rounded-lg border border-gold bg-transparent px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/10"
        >
          <span aria-hidden="true">+</span><span>Criar Novo Post</span>
        </button>
        <div className="profile-menu-control">
          <button type="button" data-tutorial-target="perfil" className="user-profile-pill flex items-center gap-2 rounded-full border border-subtle bg-surface py-1 pl-1.5 pr-3 text-sm text-zinc-300" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen(current => !current)}>
            <span className="user-avatar flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gold text-xs font-bold text-app">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : userInitials(user)}</span>
            {user?.fullName || user?.name || user?.email || 'Conta'}<span className="profile-menu-chevron" aria-hidden="true">⌄</span>
          </button>
          {profileOpen && <div className="profile-menu" role="menu">
            <div className="profile-menu-heading"><strong>{user?.fullName || user?.name || 'Minha conta'}</strong><small>{user?.email || ''}</small><span className="mt-1 inline-flex w-fit rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-gold">Plano {getPlan(user?.plan).name}</span></div>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); onNavigate('perfil') }}>Meu perfil</button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); onNavigate('seguranca') }}>Segurança</button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); onNavigate('atividade') }}>Atividades</button>
            <button type="button" role="menuitem" className="profile-menu-danger" onClick={logout}>Sair</button>
          </div>}
        </div>
      </div>
    </header>
  )
}

function userInitials(user) {
  const label = user?.name || user?.email || 'C'
  return label.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
}

function ShortcutHelp({ open, onClose }) {
  if (!open) return null
  return <div className="shortcut-help-overlay" role="presentation" onMouseDown={onClose}>
    <section className="shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" onMouseDown={event => event.stopPropagation()}>
      <div className="shortcut-help-heading"><div><p className="eyebrow">NAVEGAÇÃO RÁPIDA</p><h2 id="shortcut-help-title">Atalhos de teclado</h2></div><button type="button" className="link-button" onClick={onClose}>Fechar</button></div>
      <div className="shortcut-help-list">
        <div><kbd>C</kbd><p>Criar uma publicação</p></div>
        <div><kbd>D</kbd><p>Ir para o dashboard</p></div>
        <div><kbd>?</kbd><p>Mostrar estes atalhos</p></div>
        <div><kbd>Esc</kbd><p>Fechar janela aberta</p></div>
      </div>
      <p className="shortcut-help-note">Os atalhos de uma tecla ficam pausados enquanto você digita em um campo.</p>
    </section>
  </div>
}

export function AppShell({ page, onPageChange, children, user }) {
  return (
    <ToastProvider>
      <AppShellBody page={page} onPageChange={onPageChange} user={user}>{children}</AppShellBody>
    </ToastProvider>
  )
}

function AppShellBody({ page, onPageChange, children, user }) {
  const [open, setOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('meu-ecoo:sidebar-collapsed') === '1')
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tutorialWantsSidebar, setTutorialWantsSidebar] = useState(false)
  const currentLabel = page === 'perfil' ? 'Meu perfil' : navigation.find(([key]) => key === page)?.[1] || 'Dashboard'
  const notify = useToast()

  function toggleSidebarCollapsed() {
    setSidebarCollapsed(current => {
      const next = !current
      localStorage.setItem('meu-ecoo:sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  // Mostra o tutorial sozinho na primeira vez que a pessoa acessa o app.
  // Depois disso, só reaparece quando alguém pedir explicitamente (botão 🎓
  // no topo ou "Rever tutorial" no Perfil).
  useEffect(() => {
    if (getTutorialStatus().seen) return
    const timer = window.setTimeout(() => setTutorialOpen(true), 500)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const openTutorial = () => setTutorialOpen(true)
    window.addEventListener(TUTORIAL_OPEN_EVENT, openTutorial)
    return () => window.removeEventListener(TUTORIAL_OPEN_EVENT, openTutorial)
  }, [])

  function closeTutorial() {
    markTutorialSeen()
    setTutorialOpen(false)
  }

  function completeTutorial() {
    markTutorialCompleted()
    setTutorialOpen(false)
    notify('Tutorial concluído! Você pode revê-lo quando quiser pelo ícone 🎓.')
  }

  useEffect(() => {
    const handleShortcut = event => {
      if (event.key === 'Escape') {
        setShortcutHelpOpen(false)
        return
      }
      const tagName = event.target?.tagName?.toLowerCase()
      if (['input', 'textarea', 'select'].includes(tagName) || event.target?.isContentEditable) return
      if (event.key.toLowerCase() === 'c') { event.preventDefault(); onPageChange('agendador') }
      if (event.key.toLowerCase() === 'd') { event.preventDefault(); onPageChange('dashboard') }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) { event.preventDefault(); setShortcutHelpOpen(true) }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [onPageChange])

  return (
    <div className="app-shell-modern flex min-h-screen bg-app text-zinc-100">
      {/* No mobile a barra lateral fica fora da tela até alguém abrir o menu.
          Passos do tutorial cujo item só existe nela pedem que fique aberta
          (tutorialWantsSidebar, controlado pelo próprio AppTutorial), sem
          depender do toggle manual do usuário. */}
      <AppSidebar page={page} open={open || tutorialWantsSidebar} onNavigate={key => { onPageChange(key); setOpen(false) }} onClose={() => setOpen(false)} user={user} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebarCollapsed} />

      <div className="flex min-h-screen flex-1 flex-col">
        <AppTopbar currentLabel={currentLabel} user={user} sidebarOpen={open} onOpenSidebar={() => setOpen(v => !v)} onCreatePost={() => onPageChange('agendador')} onNavigate={onPageChange} onOpenShortcutHelp={() => setShortcutHelpOpen(true)} onOpenTutorial={() => setTutorialOpen(true)} />
        <main id="main-content" tabIndex="-1" className="app-main-content flex-1">{children}</main>
        <footer className="app-copyright"><CopyrightNotice /></footer>
      </div>

      <AiAssistantWidget currentPage={page} onNavigate={onPageChange} />
      <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
      <AppTutorial open={tutorialOpen} onNavigate={onPageChange} onClose={closeTutorial} onComplete={completeTutorial} onRequestSidebar={setTutorialWantsSidebar} />
      <MobileBottomNav page={page} onNavigate={onPageChange} onOpenMenu={() => setOpen(true)} />
    </div>
  )
}
