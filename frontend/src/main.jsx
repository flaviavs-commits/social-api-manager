import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LandingPage } from './pages/landing-page.jsx'
import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/app-shell.jsx'
import { DashboardPage } from './pages/dashboard-page.jsx'
import { ModulePage } from './pages/module-page.jsx'
import { LoginPage, ResetPasswordPage, VerifyTwoFactorPage } from './pages/auth-page.jsx'
import { AdminPage } from './pages/admin-page.jsx'
import { apiFetch } from './lib/api.js'
import './styles/tokens.css'
import './styles/app.css'
import './styles/modules.css'
import './styles/tailwind.css'
import './styles/auth.css'
import './styles/admin.css'

const APP_PAGES = new Set(['dashboard', 'agendador', 'calendario', 'rascunhos', 'analytics', 'inbox', 'integracoes', 'tokens', 'seguranca', 'atividade', 'ai'])

function pageFromLocation(pathname = window.location.pathname) {
  const segment = pathname.startsWith('/app/') ? pathname.slice('/app/'.length).split('/')[0] : ''
  return APP_PAGES.has(segment) ? segment : 'dashboard'
}

function App() {
  const [page, setPage] = useState(() => pageFromLocation())
  const [user, setUser] = useState(null)
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
    if (!APP_PAGES.has(nextPage) || nextPage === page) return
    window.history.pushState({}, '', `/app/${nextPage}`)
    setPage(nextPage)
  }
  return <AppShell page={page} onPageChange={navigate} user={user}>
    {page === 'dashboard' ? <DashboardPage onNavigate={navigate} /> : <ModulePage type={page} onNavigate={navigate} user={user} />}
  </AppShell>
}

function consumeTokenFromUrl() {
  if (window.location.pathname !== '/app.html' && !window.location.pathname.startsWith('/app/')) return
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  if (!token) return
  localStorage.setItem('authToken', token)
  params.delete('token')
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

consumeTokenFromUrl()
const pathname = window.location.pathname
const page = pathname === '/login.html' ? <LoginPage />
  : pathname === '/reset-password.html' ? <ResetPasswordPage />
    : pathname === '/verify-2fa.html' ? <VerifyTwoFactorPage />
    : pathname === '/admin.html' ? <AdminPage />
    : pathname === '/app.html' || pathname.startsWith('/app/') ? <App /> : <LandingPage />

createRoot(document.getElementById('root')).render(<StrictMode>{page}</StrictMode>)
