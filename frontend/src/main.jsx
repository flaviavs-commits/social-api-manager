import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LandingPage } from './pages/landing-page.jsx'
import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/app-shell.jsx'
import { DashboardPage } from './pages/dashboard-page.jsx'
import { ModulePage } from './pages/module-page.jsx'
import { apiFetch } from './lib/api.js'
import './styles/tokens.css'
import './styles/app.css'
import './styles/modules.css'
import './styles/tailwind.css'

function App() {
  const [page, setPage] = useState('dashboard')
  const [user, setUser] = useState(null)
  useEffect(() => {
    let active = true
    apiFetch('/api/me').then(currentUser => { if (active) setUser(currentUser) }).catch(() => {})
    return () => { active = false }
  }, [])
  const navigate = nextPage => setPage(nextPage)
  return <AppShell page={page} onPageChange={navigate} user={user}>
    {page === 'dashboard' ? <DashboardPage onNavigate={navigate} /> : <ModulePage type={page} />}
  </AppShell>
}

const isApp = window.location.pathname === '/app.html' || window.location.pathname.startsWith('/app/')
createRoot(document.getElementById('root')).render(<StrictMode>{isApp ? <App /> : <LandingPage />}</StrictMode>)
