import { useEffect, useState } from 'react'
import { PLANS } from '../lib/plans.js'
import { CopyrightNotice } from '../components/ui/copyright-notice.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'

const plans = Object.values(PLANS).map((plan, index) => ({
  ...plan,
  tierNumber: String(index + 1).padStart(2, '0'),
  featured: plan.id === 'pro',
  features: plan.features.map(feature => feature.replace('Analise', 'Análise')),
}))

function Icon({ name, size = 18 }) {
  const paths = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    sparkle: <><path d="m12 3-1.6 4.4L6 9l4.4 1.6L12 15l1.6-4.4L18 9l-4.4-1.6L12 3ZM5 16l-.8 2.2L2 19l2.2.8L5 22l.8-2.2L8 19l-2.2-.8L5 16ZM19 14l-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8L19 14Z" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  }

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Logo({ footer = false }) {
  return <a className={`landing-logo${footer ? ' landing-logo--footer' : ''}`} href="/" aria-label="MeuEcooMidia, início">
    <img className="landing-logo-img" src="/logo.png" alt="MeuEcooMidia" />
  </a>
}

function DashboardMock() {
  const metrics = [
    { icon: 'eye', className: 'gold', label: 'Visualizações', value: '48,6 mil', change: '+28%' },
    { icon: 'heart', className: 'pink', label: 'Interações', value: '3.842', change: '+17%' },
    { icon: 'users', className: 'blue', label: 'Novos seguidores', value: '+1.274', change: '+32%' },
  ]

  return <div className="landing-dashboard" aria-label="Demonstração do painel MeuEcooMidia">
    <div className="dashboard-topbar"><div className="dashboard-mini-logo" aria-hidden="true"><img src="/logo-icon.png" alt="" /></div><div className="dashboard-search">⌕ &nbsp;Buscar na plataforma</div><div className="dashboard-user">BA</div></div>
    <div className="dashboard-body">
      <aside className="dashboard-sidebar"><span className="is-active">⌂</span><span>□</span><span>◇</span><span>≋</span></aside>
      <div className="dashboard-content">
        <div className="dashboard-heading"><div><small>VISÃO GERAL</small><h3>Bom dia, Mariana 👋</h3></div><span className="dashboard-period">Últimos 30 dias⌄</span></div>
        <div className="dashboard-metrics">{metrics.map(metric => <div className="dashboard-metric" key={metric.label}><div className={`metric-icon ${metric.className}`}><Icon name={metric.icon} size={14} /></div><small>{metric.label}</small><strong>{metric.value}</strong><span>↗ {metric.change}</span></div>)}</div>
        <div className="dashboard-chart"><div className="chart-title"><div><b>Crescimento da audiência</b><small>Desempenho consolidado</small></div><span>Alcance</span></div><div className="chart-area"><div className="chart-lines" /><svg viewBox="0 0 560 150" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="landing-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e7a92e" stopOpacity=".35" /><stop offset="1" stopColor="#e7a92e" stopOpacity="0" /></linearGradient></defs><path d="M0 125 C45 120 70 90 110 95 S170 112 210 72 S270 38 310 60 S370 105 420 48 S500 20 560 18 L560 150 L0 150Z" fill="url(#landing-area)" /><path d="M0 125 C45 120 70 90 110 95 S170 112 210 72 S270 38 310 60 S370 105 420 48 S500 20 560 18" fill="none" stroke="#e7a92e" strokeWidth="3" /></svg><div className="chart-labels"><span>01 Ago</span><span>08 Ago</span><span>15 Ago</span><span>22 Ago</span><span>30 Ago</span></div></div></div>
      </div>
    </div>
    <div className="dashboard-float"><span className="float-check"><Icon name="check" size={14} /></span><div><b>Post publicado!</b><small>Instagram • há 2 min</small></div></div>
  </div>
}

function CalendarMock() {
  const days = Array.from({ length: 28 }, (_, index) => index + 1)
  return <div className="calendar-mock"><div className="calendar-head"><b>Agosto 2026</b><span>‹ &nbsp;›</span></div><div className="calendar-week">{['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((day, index) => <b key={`${day}-${index}`}>{day}</b>)}</div><div className="calendar-days">{days.map(day => <span className={[9, 14, 20].includes(day) ? 'has-post' : ''} key={day}>{day}{[9, 14, 20].includes(day) && <i />}</span>)}</div></div>
}

function ReportMock() {
  return <div className="report-card"><div className="report-head"><div><span className="landing-logo-mark landing-logo-mark--small" aria-hidden="true"><img src="/logo-icon.png" alt="" /></span><b>Relatório de desempenho</b></div><div className="period-switch"><button>7 dias</button><button className="selected">30 dias</button><button>90 dias</button></div></div><p>Visão geral • <b>30 dias</b></p><div className="report-metrics"><div><small>Visualizações</small><strong>48,6k</strong><span>↗ 28%</span></div><div><small>Interações</small><strong>3.842</strong><span>↗ 17%</span></div><div><small>Taxa de interação</small><strong>7,9%</strong><span>↗ 1,4%</span></div></div><div className="report-insight"><Icon name="sparkle" size={18} /><p><b>Leitura rápida</b> Seus Reels tiveram 2,4× mais alcance. Repita temas educativos em vídeos curtos.</p></div></div>
}

function FeatureIcon({ name, tone = '' }) {
  return <div className={`feature-icon ${tone}`}><Icon name={name} size={20} /></div>
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'

    if (window.location.pathname === '/como-funciona') {
      const section = document.getElementById('como-funciona')
      if (section) window.requestAnimationFrame(() => section.scrollIntoView({ block: 'start' }))
    } else {
      if (window.location.hash) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
      window.scrollTo(0, 0)
      window.requestAnimationFrame(() => window.scrollTo(0, 0))
    }

    return () => { window.history.scrollRestoration = previousScrollRestoration }
  }, [])

  return <main className="landing-page" id="inicio">
    <header className="landing-nav-wrap"><nav className="landing-nav landing-container" aria-label="Navegação principal"><Logo /><button className="landing-menu-button" aria-label="Abrir menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(current => !current)}><Icon name="menu" size={22} /></button><div className={`landing-nav-links${menuOpen ? ' is-open' : ''}`}><a href="#recursos" onClick={() => setMenuOpen(false)}>Recursos</a><a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a><a href="#resultados" onClick={() => setMenuOpen(false)}>Resultados</a><a href="#planos" onClick={() => setMenuOpen(false)}>Planos</a></div><div className="landing-nav-actions"><a className="landing-login-link" href="/login.html">Entrar</a><a className="landing-nav-cta" href="#planos" onClick={() => setMenuOpen(false)}>Conhecer os planos <Icon name="arrow" size={16} /></a></div></nav></header>

    <section className="landing-hero landing-container"><div className="landing-hero-copy"><div className="landing-eyebrow"><span className="landing-live-dot" /> Gestão inteligente para redes sociais</div><h1>Sua marca mais longe.<br /><em>Seu trabalho mais simples.</em></h1><p>Planeje, publique e acompanhe os resultados de todas as suas redes sociais em um único lugar — com dados que ajudam você a decidir o próximo passo.</p><div className="landing-hero-actions"><a className="landing-btn landing-btn--primary" href="#planos">Ver planos e preços <Icon name="arrow" /></a><a className="landing-btn landing-btn--ghost" href="#como-funciona"><span className="landing-play"><Icon name="play" size={14} /></span> Ver como funciona</a></div><div className="landing-trust"><div className="landing-avatars"><span>LA</span><span>MS</span><span>RC</span><span>+8k</span></div><p><b>Mais tempo para criar.</b><br />Menos tempo entre abas e planilhas.</p></div></div><DashboardMock /></section>

    <section className="landing-network-strip"><div className="landing-container"><p>Conecte e gerencie as redes que fazem parte da sua estratégia</p><div className="landing-network-list"><span><PlatformIcon platform="instagram" className="landing-platform-icon" /> Instagram</span><span><PlatformIcon platform="facebook" className="landing-platform-icon" /> Facebook</span><span><PlatformIcon platform="youtube" className="landing-platform-icon" /> YouTube</span><span><PlatformIcon platform="tiktok" className="landing-platform-icon" /> TikTok</span></div></div></section>

    <section className="landing-section landing-container" id="recursos"><div className="landing-section-kicker">TUDO EM UM SÓ LUGAR</div><h2>Da ideia ao resultado,<br /><em>sem perder o ritmo.</em></h2><p className="landing-section-intro">Uma plataforma feita para quem quer transformar presença digital em crescimento — sem complicação.</p><div className="landing-feature-grid"><article className="landing-feature landing-feature--featured"><div className="landing-feature-copy"><FeatureIcon name="calendar" /><h3>Planeje com clareza.<br />Publique no tempo certo.</h3><p>Organize seu calendário editorial e agende conteúdos para diferentes redes em poucos cliques.</p><a href="/app/calendario">Conhecer agendamento <Icon name="arrow" size={16} /></a></div><CalendarMock /></article><article className="landing-feature"><FeatureIcon name="chart" tone="pink" /><h3>Entenda o que está funcionando.</h3><p>Relatórios claros, métricas por rede e leituras rápidas que transformam números em decisões.</p><div className="landing-stat-bars">{[42, 65, 52, 88, 74, 100].map((height, index) => <span style={{ height: `${height}%` }} key={index} />)}</div></article><article className="landing-feature"><FeatureIcon name="users" tone="blue" /><h3>Aprove com sua equipe e seus clientes.</h3><p>Centralize comentários, ajustes e aprovações. Menos mensagens perdidas, mais fluidez.</p><div className="landing-approval"><div><span>CR</span><p><b>Campanha de agosto</b><small>Pronto para aprovação</small></p></div><button><Icon name="check" size={14} /> Aprovar</button></div></article><article className="landing-feature"><FeatureIcon name="sparkle" tone="purple" /><h3>Crie melhor com apoio da IA.</h3><p>Gere ideias, refine legendas e receba insights para manter sua comunicação relevante.</p><div className="landing-ai-box"><span><Icon name="sparkle" size={16} /></span><p>Crie uma legenda envolvente para...</p><i /></div></article></div></section>

    <section className="landing-results" id="resultados"><div className="landing-container landing-results-grid"><div className="landing-result-copy"><div className="landing-section-kicker">DADOS QUE FALAM COM VOCÊ</div><h2>Relatórios bonitos.<br /><em>Insights que fazem sentido.</em></h2><p>Visualize o desempenho de cada rede, compare períodos e descubra rapidamente onde estão as melhores oportunidades.</p><ul><li><Icon name="check" size={17} /> Métricas consolidadas em tempo real</li><li><Icon name="check" size={17} /> Comparação entre períodos e redes</li><li><Icon name="check" size={17} /> Recomendações práticas de próxima ação</li></ul></div><ReportMock /></div></section>

    <section className="landing-section landing-how-section landing-container" id="como-funciona"><div className="landing-section-kicker">COMECE SEM COMPLICAÇÃO</div><h2>Conecte. Organize. <em>Cresça.</em></h2><div className="landing-steps"><article><span>01</span><div className="landing-step-line" /><h3>Conecte suas redes</h3><p>Autorize seus perfis com segurança pelo fluxo oficial de cada plataforma.</p></article><article><span>02</span><div className="landing-step-line" /><h3>Organize seu conteúdo</h3><p>Crie, revise e agende publicações em um calendário único e visual.</p></article><article><span>03</span><div className="landing-step-line" /><h3>Acompanhe e evolua</h3><p>Veja os resultados, entenda os sinais e melhore sua estratégia continuamente.</p></article></div></section>

    <section className="landing-section landing-plans landing-container" id="planos"><div className="landing-plans-heading"><div><div className="landing-section-kicker">PLANOS PARA CADA MOMENTO</div><h2>Escolha o plano ideal<br />para suas redes.</h2></div><p>Comece com o essencial e evolua quando sua presença digital crescer.</p></div><div className="landing-plans-grid">{plans.map(plan => <article className={`landing-plan${plan.featured ? ' is-popular' : ''}`} key={plan.id}>{plan.featured && <div className="landing-popular-badge">Mais escolhido</div>}<div className="landing-plan-top"><div><span>TIER {plan.tierNumber}</span><h3>{plan.name.replace('EcooMidia ', 'EcooMidia\n')}</h3></div><div className="landing-plan-price"><strong>{plan.price}</strong><small>{plan.cadence}</small></div></div><p>{plan.description}</p><ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul><a className={`landing-plan-btn${plan.featured ? ' is-primary' : ''}`} href={`/criar-conta?plan=${plan.id}`}>Assinar {plan.name} <Icon name="arrow" size={15} /></a></article>)}</div></section>

    <section className="landing-contact" id="contato"><div className="landing-container landing-contact-inner"><Logo footer /><h2>Vamos transformar sua rotina<br />nas redes sociais?</h2><p>Escolha o plano que combina com o momento da sua presença digital.</p><a className="landing-btn landing-btn--primary" href="#planos">Escolher meu plano <Icon name="arrow" /></a></div></section>
    <footer className="landing-footer"><div className="landing-container landing-footer-inner"><CopyrightNotice /><div><a href="/terms-of-service.html">Termos de uso</a><a href="/privacy-policy.html">Privacidade</a><a href="mailto:contato@meuecoomidia.com.br">Contato</a></div></div></footer>
  </main>
}
