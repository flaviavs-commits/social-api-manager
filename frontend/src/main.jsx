import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LandingPage } from './pages/landing-page.jsx'
import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/app-shell.jsx'
import { DashboardPage } from './pages/dashboard-page.jsx'
import { ModulePage } from './pages/module-page.jsx'
import { PlanGate } from './components/ui/plan-gate.jsx'
import { hasActivePlanModule } from './lib/plans.js'
import { CreateAccountPage, LoginPage, ResetPasswordPage, VerifyTwoFactorPage } from './pages/auth-page.jsx'
import { AdminPage } from './pages/admin-page.jsx'
import { apiFetch } from './lib/api.js'
import { applyTheme, getStoredTheme } from './components/ui/theme-selector.jsx'
import { TEAM_APPROVAL_UI_ENABLED } from './lib/feature-flags.js'
import './styles/tokens.css'
import './styles/app.css'
import './styles/modules.css'
import './styles/dashboard-theme.css'
import './styles/global-ui.css'
import './styles/analytics-audience.css'
import './styles/analytics-demographic.css'
import './styles/analytics-post-metrics.css'
import './styles/tokens-page.css'
import './styles/tailwind.css'
import './styles/auth.css'
import './styles/landing.css'
import './styles/queues.css'
import './styles/admin.css'
import './styles/scheduler-theme.css'
import './styles/drafts-theme.css'
import './styles/calendar.css'
import './styles/scheduler-composer.css'
import './styles/ai-page-publish.css'
import './styles/workspace-page.css'
import './styles/theme.css'
import './styles/light-theme.css'
import './styles/semantic-theme.css'
import './styles/smartlinks.css'
import './styles/tutorial.css'
import './styles/responsive.css'
import './styles/mobile-first.css'

applyTheme(getStoredTheme())

const APP_PAGES = new Set(['dashboard', 'agendador', 'calendario', 'rascunhos', 'analytics', 'inbox', 'integracoes', 'tokens', 'seguranca', 'atividade', 'ai', 'perfil', 'biblioteca', 'filas', 'smartlinks', 'equipe'])

function pageFromLocation(pathname = window.location.pathname) {
  const segment = pathname.startsWith('/app/') ? pathname.slice('/app/'.length).split('/')[0] : ''
  if (segment === 'equipe' && !TEAM_APPROVAL_UI_ENABLED) return 'dashboard'
  return APP_PAGES.has(segment) ? segment : 'dashboard'
}

function App() {
  const [page, setPage] = useState(() => pageFromLocation())
  const [user, setUser] = useState(null)
  const updateUser = patch => setUser(current => ({ ...(current || {}), ...patch }))
  useEffect(() => {
    if (window.location.pathname === '/app/automacoes') window.history.replaceState({}, '', '/app/dashboard')
    if (window.location.pathname === '/app/equipe' && !TEAM_APPROVAL_UI_ENABLED) window.history.replaceState({}, '', '/app/dashboard')
  }, [])
  useEffect(() => {
    let active = true
    apiFetch('/api/me').then(currentUser => { if (active) setUser(currentUser) }).catch(() => {})
    return () => { active = false }
  }, [])
  useEffect(() => {
    const onPopState = () => setPage(pageFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const navigate = nextPage => {
    if (nextPage === 'equipe' && !TEAM_APPROVAL_UI_ENABLED) return
    if (!APP_PAGES.has(nextPage) || nextPage === page) return
    window.history.pushState({}, '', `/app/${nextPage}`)
    setPage(nextPage)
  }
  return <AppShell page={page} onPageChange={navigate} user={user}>
    {page === 'dashboard'
      ? user && !hasActivePlanModule(user.plan, 'dashboard', user.planActive, user.planUnrestricted)
        ? <PlanGate currentPlan={user.plan} moduleName="dashboard" planActive={user.planActive} />
        : <DashboardPage onNavigate={navigate} />
      : <ModulePage type={page} onNavigate={navigate} user={user} onUserChange={updateUser} />}
  </AppShell>
}

const pathname = window.location.pathname
const page = pathname === '/criar-conta' ? <CreateAccountPage />
  : pathname === '/login.html' ? <LoginPage />
  : pathname === '/reset-password.html' ? <ResetPasswordPage />
    : pathname === '/verify-2fa.html' ? <VerifyTwoFactorPage />
    : pathname === '/admin.html' ? <AdminPage />
    : pathname === '/app.html' || pathname.startsWith('/app/') ? <App /> : <LandingPage />

createRoot(document.getElementById('root')).render(<StrictMode>{page}</StrictMode>)
