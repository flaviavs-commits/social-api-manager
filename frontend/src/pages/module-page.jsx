import { lazy, Suspense } from 'react'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { PlanGate } from '../components/ui/plan-gate.jsx'
import { hasActivePlanModule } from '../lib/plans.js'

const SchedulerPage = lazy(() => import('./scheduler-page.jsx').then(module => ({ default: module.SchedulerPage })))
const CalendarPage = lazy(() => import('./calendar-page.jsx').then(module => ({ default: module.CalendarPage })))
const DraftsPage = lazy(() => import('./drafts-page.jsx').then(module => ({ default: module.DraftsPage })))
const AccountsPage = lazy(() => import('./accounts-page.jsx').then(module => ({ default: module.AccountsPage })))
const AnalyticsPage = lazy(() => import('./analytics-page.jsx').then(module => ({ default: module.AnalyticsPage })))
const InboxPage = lazy(() => import('./inbox-page.jsx').then(module => ({ default: module.InboxPage })))
const SecurityPage = lazy(() => import('./security-page.jsx').then(module => ({ default: module.SecurityPage })))
const ActivityPage = lazy(() => import('./activity-page.jsx').then(module => ({ default: module.ActivityPage })))
const AiPage = lazy(() => import('./ai-page.jsx').then(module => ({ default: module.AiPage })))
const ProfilePage = lazy(() => import('./profile-page.jsx').then(module => ({ default: module.ProfilePage })))
const MediaLibraryPage = lazy(() => import('./media-library-page.jsx').then(module => ({ default: module.MediaLibraryPage })))
const ContentQueuesPage = lazy(() => import('./content-queues-page.jsx').then(module => ({ default: module.ContentQueuesPage })))
const SmartlinksPage = lazy(() => import('./smartlinks-page.jsx').then(module => ({ default: module.SmartlinksPage })))
const WorkspacePage = lazy(() => import('./workspace-page.jsx').then(module => ({ default: module.WorkspacePage })))

const PAGES_BY_TYPE = {
  agendador: SchedulerPage,
  calendario: CalendarPage,
  rascunhos: DraftsPage,
  integracoes: AccountsPage,
  analytics: AnalyticsPage,
  inbox: InboxPage,
  seguranca: SecurityPage,
  atividade: ActivityPage,
  ai: AiPage,
  perfil: ProfilePage,
  biblioteca: MediaLibraryPage,
  filas: ContentQueuesPage,
  smartlinks: SmartlinksPage,
  equipe: WorkspacePage,
}

const descriptions = {
  agendador: ['Novo post', 'Crie uma publicação para suas redes conectadas.'],
  calendario: ['Calendário', 'Visualize suas publicações agendadas.'],
  rascunhos: ['Baú de Ideias', 'Gere e continue trabalhando nas ideias de publicações salvas.'],
  analytics: ['Analytics', 'Acompanhe o desempenho das suas publicações.'],
  inbox: ['Inbox', 'Gerencie comentários e interações em um só lugar.'],
  integracoes: ['Contas conectadas', 'Conecte e gerencie suas redes sociais.'],
  seguranca: ['Segurança', 'Proteja sua conta e gerencie a autenticação em 2 fatores.'],
  atividade: ['Atividades', 'Consulte o histórico recente da sua conta.'],
  ai: ['Assistente inteligente', 'Use o assistente para planejar e revisar conteúdos.'],
  biblioteca: ['Sua biblioteca de mídia', 'Organize fotos e vídeos reutilizáveis.'],
 filas: ['Repetidor de posts', 'Automatize publicações que se repetem.'],
  smartlinks: ['Smartlinks', 'Converta links da bio em oportunidades.'],
  equipe: ['Equipe', 'Aprove conteúdos e organize sua operação.'],
}

export function ModulePage({ type, onNavigate, user, onUserChange }) {
  // O perfil é a área onde a pessoa escolhe e paga o plano, portanto precisa
  // continuar acessível antes da ativação. Os demais módulos dependem do
  // pagamento confirmado.
  if (type !== 'perfil' && user && !hasActivePlanModule(user.plan, type, user.planActive, user.planUnrestricted)) return <PlanGate currentPlan={user.plan} moduleName={type} planActive={user.planActive} />
  const Page = PAGES_BY_TYPE[type]
  if (Page) return <Suspense fallback={<section className="page-view"><section className="panel"><LoadingState>Carregando módulo...</LoadingState></section></section>}><Page onNavigate={onNavigate} user={user} onUserChange={onUserChange}/></Suspense>
  const [title, description] = descriptions[type] || ['Módulo', 'Área da aplicação']
  return <section className="page-view"><section className="panel module-placeholder"><p className="eyebrow">MÓDULO REACT</p><h2>{title}</h2><p>{description}</p><span className="status-badge">Migração em andamento</span></section></section>
}
