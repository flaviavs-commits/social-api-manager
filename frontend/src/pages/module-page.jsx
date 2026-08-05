import { lazy, Suspense } from 'react'
import { LoadingState } from '../components/ui/loading-state.jsx'

const SchedulerPage = lazy(() => import('./scheduler-page.jsx').then(module => ({ default: module.SchedulerPage })))
const CalendarPage = lazy(() => import('./calendar-page.jsx').then(module => ({ default: module.CalendarPage })))
const DraftsPage = lazy(() => import('./drafts-page.jsx').then(module => ({ default: module.DraftsPage })))
const AccountsPage = lazy(() => import('./accounts-page.jsx').then(module => ({ default: module.AccountsPage })))
const AnalyticsPage = lazy(() => import('./analytics-page.jsx').then(module => ({ default: module.AnalyticsPage })))
const InboxPage = lazy(() => import('./inbox-page.jsx').then(module => ({ default: module.InboxPage })))
const TokensPage = lazy(() => import('./tokens-page.jsx').then(module => ({ default: module.TokensPage })))
const SecurityPage = lazy(() => import('./security-page.jsx').then(module => ({ default: module.SecurityPage })))
const ActivityPage = lazy(() => import('./activity-page.jsx').then(module => ({ default: module.ActivityPage })))
const AiPage = lazy(() => import('./ai-page.jsx').then(module => ({ default: module.AiPage })))
const ProfilePage = lazy(() => import('./profile-page.jsx').then(module => ({ default: module.ProfilePage })))

const PAGES_BY_TYPE = {
  agendador: SchedulerPage,
  calendario: CalendarPage,
  rascunhos: DraftsPage,
  integracoes: AccountsPage,
  analytics: AnalyticsPage,
  inbox: InboxPage,
  tokens: TokensPage,
  seguranca: SecurityPage,
  atividade: ActivityPage,
  ai: AiPage,
  perfil: ProfilePage,
}

const descriptions = {
  agendador: ['Novo post', 'Crie uma publicação para suas redes conectadas.'],
  calendario: ['Calendário', 'Visualize suas publicações agendadas.'],
  rascunhos: ['Rascunhos', 'Continue trabalhando nas publicações salvas.'],
  analytics: ['Analytics', 'Acompanhe o desempenho das suas publicações.'],
  inbox: ['Inbox', 'Gerencie comentários e interações em um só lugar.'],
  integracoes: ['Contas conectadas', 'Conecte e gerencie suas redes sociais.'],
  tokens: ['Tokens', 'Gerencie tokens de acesso e integrações.'],
  seguranca: ['Segurança', 'Proteja sua conta e gerencie a autenticação em 2 fatores.'],
  atividade: ['Atividades', 'Consulte o histórico recente da sua conta.'],
  ai: ['Assistente IA', 'Use o assistente para planejar e revisar conteúdos.'],
}

export function ModulePage({ type, onNavigate, user, onUserChange }) {
  const Page = PAGES_BY_TYPE[type]
  if (Page) return <Suspense fallback={<section className="page-view"><section className="panel"><LoadingState>Carregando módulo...</LoadingState></section></section>}><Page onNavigate={onNavigate} user={user} onUserChange={onUserChange}/></Suspense>
  const [title, description] = descriptions[type] || ['Módulo', 'Área da aplicação']
  return <section className="page-view"><section className="panel module-placeholder"><p className="eyebrow">MÓDULO REACT</p><h2>{title}</h2><p>{description}</p><span className="status-badge">Migração em andamento</span></section></section>
}
