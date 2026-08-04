import { SchedulerPage } from './scheduler-page.jsx'
import { CalendarPage } from './calendar-page.jsx'
import { DraftsPage } from './drafts-page.jsx'
import { AccountsPage } from './accounts-page.jsx'
import { AnalyticsPage } from './analytics-page.jsx'
import { InboxPage } from './inbox-page.jsx'
import { TokensPage } from './tokens-page.jsx'
import { AiPage } from './ai-page.jsx'

const PAGES_BY_TYPE = {
  agendador: SchedulerPage,
  calendario: CalendarPage,
  rascunhos: DraftsPage,
  integracoes: AccountsPage,
  analytics: AnalyticsPage,
  inbox: InboxPage,
  tokens: TokensPage,
  ai: AiPage,
}

const descriptions = {
  agendador: ['Novo post', 'Crie uma publicação para suas redes conectadas.'],
  calendario: ['Calendário', 'Visualize suas publicações agendadas.'],
  rascunhos: ['Rascunhos', 'Continue trabalhando nas publicações salvas.'],
  analytics: ['Analytics', 'Acompanhe o desempenho das suas publicações.'],
  inbox: ['Inbox', 'Gerencie comentários e interações em um só lugar.'],
  integracoes: ['Contas conectadas', 'Conecte e gerencie suas redes sociais.'],
  tokens: ['Tokens', 'Gerencie tokens de acesso e integrações.'],
  ai: ['Assistente IA', 'Use o assistente para planejar e revisar conteúdos.'],
}

export function ModulePage({ type }) {
  const Page = PAGES_BY_TYPE[type]
  if (Page) return <Page/>
  const [title, description] = descriptions[type] || ['Módulo', 'Área da aplicação']
  return <section className="page-view"><section className="panel module-placeholder"><p className="eyebrow">MÓDULO REACT</p><h2>{title}</h2><p>{description}</p><span className="status-badge">Migração em andamento</span></section></section>
}
