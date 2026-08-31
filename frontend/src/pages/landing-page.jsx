import { useEffect, useState } from 'react'
import { PLANS } from '../lib/plans.js'
import { CopyrightNotice } from '../components/ui/copyright-notice.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { ThemeToggleButton } from '../components/ui/theme-selector.jsx'
import logo from '../../../public/logo.png'
import logoIcon from '../../../public/logo-icon.png'

const plans = Object.values(PLANS).map((plan, index) => ({
  ...plan,
  tierNumber: String(index + 1).padStart(2, '0'),
  featured: plan.id === 'pro',
  offer: plan.meuEcooOffer || 'Sem acesso ao MeuEcoo',
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
    folder: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" /><path d="M3 9h18" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    message: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3.4-.7L4 20l1.2-3.5A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
    link: <><path d="M10 13.5 8.5 15a3.2 3.2 0 0 1-4.5-4.5l2-2a3.2 3.2 0 0 1 4.5 0" /><path d="m14 10.5 1.5-1.5a3.2 3.2 0 1 1 4.5 4.5l-2 2a3.2 3.2 0 0 1-4.5 0" /><path d="m8.5 15.5 7-7" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-4.5-4.5L8 19" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  }

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Logo({ footer = false }) {
  return <a className={`landing-logo${footer ? ' landing-logo--footer' : ''}`} href="/" aria-label="MeuEcooMidia, início">
    <img className="landing-logo-img" src={logo} alt="MeuEcooMidia" />
  </a>
}

function DashboardMock() {
  const metrics = [
    { icon: 'eye', className: 'gold', label: 'Visualizações', value: '48,6 mil', change: '+28%' },
    { icon: 'heart', className: 'pink', label: 'Interações', value: '3.842', change: '+17%' },
    { icon: 'users', className: 'blue', label: 'Novos seguidores', value: '+1.274', change: '+32%' },
  ]

  return <div className="landing-dashboard" aria-label="Demonstração do painel MeuEcooMidia">
    <div className="dashboard-topbar"><div className="dashboard-mini-logo" aria-hidden="true"><img src={logoIcon} alt="" /></div><div className="dashboard-search">⌕ &nbsp;Buscar na plataforma</div><div className="dashboard-user">MA</div></div>
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
  return <div className="report-card"><div className="report-head"><div><span className="landing-logo-mark landing-logo-mark--small" aria-hidden="true"><img src={logoIcon} alt="" /></span><b>Relatório de desempenho</b></div><div className="period-switch"><button>7 dias</button><button className="selected">30 dias</button><button>90 dias</button></div></div><p>Visão geral • <b>30 dias</b></p><div className="report-metrics"><div><small>Visualizações</small><strong>48,6k</strong><span>↗ 28%</span></div><div><small>Interações</small><strong>3.842</strong><span>↗ 17%</span></div><div><small>Taxa de interação</small><strong>7,9%</strong><span>↗ 1,4%</span></div></div><div className="report-insight"><img className="landing-insight-logo" src={logoIcon} alt="" /><p><b>Leitura rápida</b> Seus Reels tiveram 2,4× mais alcance. Repita temas educativos em vídeos curtos.</p></div></div>
}

function FeatureIcon({ name, tone = '' }) {
  return <div className={`feature-icon ${tone}`}><Icon name={name} size={20} /></div>
}

function PlatformScreenshot({ type }) {
  if (type === 'planner') return <div className="platform-shot platform-shot--planner" aria-label="Prévia do criador de posts e calendário">
    <div className="platform-shot-top"><b>Novo post</b><span>Salvar rascunho</span></div>
    <div className="platform-shot-compose"><div className="platform-shot-media"><Icon name="image" size={25} /><small>Adicione uma mídia</small></div><div className="platform-shot-compose-copy"><div className="platform-shot-networks"><PlatformIcon platform="instagram" /><PlatformIcon platform="facebook" /><PlatformIcon platform="tiktok" /><PlatformIcon platform="youtube" /><span>4 redes selecionadas</span></div><div className="platform-shot-lines"><i /><i /><i className="short" /></div><div className="platform-shot-schedule"><span><Icon name="clock" size={12} /> Amanhã, 18:00</span><b><Icon name="check" size={12} /> Agendar post</b></div></div></div>
    <div className="platform-shot-bottom"><span><Icon name="calendar" size={13} /> Calendário</span><span><Icon name="folder" size={13} /> Biblioteca</span><span className="platform-shot-ai"><Icon name="sparkle" size={13} /> Sugestão de melhor horário</span></div>
  </div>

  if (type === 'ai') return <div className="platform-shot platform-shot--ai" aria-label="Prévia do assistente de inteligência artificial">
    <div className="platform-shot-top"><b><span className="platform-shot-avatar"><Icon name="sparkle" size={13} /></span> Assistente MeuEcooMídia</b><span>Contexto do negócio ativo</span></div>
    <div className="platform-shot-chat"><div className="platform-shot-bubble platform-shot-bubble--user">Crie 3 ideias para a campanha de verão e agende a melhor para amanhã.</div><div className="platform-shot-bubble platform-shot-bubble--ai"><b>Separei três caminhos:</b><div className="platform-shot-ideas"><span>01 · Bastidores da marca <Icon name="check" size={11} /></span><span>02 · Dica rápida em vídeo <Icon name="check" size={11} /></span><span>03 · Oferta para a comunidade <Icon name="check" size={11} /></span></div><small>Também posso adaptar legenda, mídia e horário para cada rede.</small></div></div>
    <div className="platform-shot-prompt"><span>Peça qualquer coisa para a IA...</span><b><Icon name="arrow" size={13} /></b></div>
  </div>

  if (type === 'analytics') return <div className="platform-shot platform-shot--analytics" aria-label="Prévia do painel de análise de desempenho e audiência">
    <div className="platform-shot-top"><b>Visão geral</b><span>Todos os canais⌄</span></div>
    <div className="platform-shot-metrics"><div><small>Alcance</small><strong>48,6k</strong><em>+28%</em></div><div><small>Interações</small><strong>3.842</strong><em>+17%</em></div><div><small>Seguidores</small><strong>+1.274</strong><em>+32%</em></div></div>
    <div className="platform-shot-chart"><div className="platform-shot-chart-head"><b>Crescimento da audiência</b><span>30 dias</span></div><div className="platform-shot-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
    <div className="platform-shot-audience"><span><Icon name="users" size={13} /> Público principal: 25–34 anos</span><span><Icon name="clock" size={13} /> Melhor horário: terça, 18h</span></div>
  </div>

  if (type === 'engagement') return <div className="platform-shot platform-shot--engagement" aria-label="Prévia do inbox e smartlink">
    <div className="platform-shot-top"><b>Engajamento</b><span>3 novas interações</span></div>
    <div className="platform-shot-engagement-grid"><div className="platform-shot-inbox"><div className="platform-shot-inbox-title"><Icon name="message" size={13} /> Inbox centralizado</div><div className="platform-shot-inbox-row active"><span>MS</span><p><b>Mariana Silva</b><small>Adorei esse conteúdo! ❤️</small></p><em>agora</em></div><div className="platform-shot-inbox-row"><span>RC</span><p><b>Rafael Costa</b><small>Qual é o link?</small></p><em>2m</em></div><div className="platform-shot-inbox-row"><span>LA</span><p><b>Luiza Alves</b><small>Comentou no YouTube</small></p><em>8m</em></div></div><div className="platform-shot-smartlink"><div className="platform-shot-smartlink-icon"><Icon name="link" size={18} /></div><b>Seu Smartlink</b><small>meuecoo.bio/minhamarca</small><div><span>Instagram</span><span>WhatsApp</span><span>Site</span><span>YouTube</span></div></div></div>
  </div>

  if (type === 'security') return <div className="platform-shot platform-shot--security" aria-label="Prévia das configurações de segurança e integrações">
    <div className="platform-shot-top"><b>Segurança e integrações</b><span>Conta protegida</span></div>
    <div className="platform-shot-security-list"><div><span className="platform-shot-security-icon"><Icon name="shield" size={16} /></span><p><b>Autenticação em duas etapas</b><small>Ativada para sua conta</small></p><em>Ativo</em></div><div><span className="platform-shot-security-icon"><Icon name="check" size={16} /></span><p><b>Login rápido via Google</b><small>Conectado com segurança</small></p><em>Ativo</em></div><div><span className="platform-shot-security-icon"><Icon name="link" size={16} /></span><p><b>Redes e chaves de acesso</b><small>Instagram · Facebook · TikTok · YouTube</small></p><em>Gerenciar</em></div></div>
  </div>

  return <div className="platform-shot platform-shot--assets" aria-label="Prévia da biblioteca de ativos"><div className="platform-shot-top"><b>Biblioteca de ativos</b><span>+ Nova pasta</span></div><div className="platform-shot-assets-head"><Icon name="folder" size={14} /> Todos os arquivos <span>128 itens</span></div><div className="platform-shot-assets-grid"><div><span className="platform-shot-thumb thumb-gold"><Icon name="image" size={17} /></span><small>Campanha verão</small></div><div><span className="platform-shot-thumb thumb-pink"><Icon name="image" size={17} /></span><small>Produtos</small></div><div><span className="platform-shot-thumb thumb-blue"><Icon name="folder" size={17} /></span><small>Textos e hashtags</small></div><div><span className="platform-shot-thumb thumb-purple"><Icon name="folder" size={17} /></span><small>Rascunhos</small></div></div></div>
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'

    if (window.location.hash) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
    window.scrollTo(0, 0)
    window.requestAnimationFrame(() => window.scrollTo(0, 0))

    return () => { window.history.scrollRestoration = previousScrollRestoration }
  }, [])

  return <main className="landing-page" id="inicio">
    <header className="landing-nav-wrap"><nav className="landing-nav landing-container" aria-label="Navegação principal"><Logo /><button className="landing-menu-button" aria-label="Abrir menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(current => !current)}><Icon name="menu" size={22} /></button><div className={`landing-nav-links${menuOpen ? ' is-open' : ''}`}><a href="#recursos" onClick={() => setMenuOpen(false)}>Recursos</a><a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a><a href="#resultados" onClick={() => setMenuOpen(false)}>Resultados</a><a href="#planos" onClick={() => setMenuOpen(false)}>Planos</a></div><div className="landing-nav-actions"><ThemeToggleButton className="landing-theme-toggle"/><a className="landing-login-link" href="/login.html">Entrar</a><a className="landing-nav-cta" href="#planos" onClick={() => setMenuOpen(false)}>Conhecer os planos <Icon name="arrow" size={16} /></a></div></nav></header>

    <section className="landing-hero landing-container"><div className="landing-hero-copy"><div className="landing-eyebrow"><span className="landing-live-dot" /> Gestão inteligente para redes sociais</div><h1>Sua marca mais longe.<br /><em>Seu trabalho mais simples.</em></h1><p>Planeje, publique e acompanhe os resultados de todas as suas redes sociais em um único lugar — com dados que ajudam você a decidir o próximo passo.</p><div className="landing-hero-actions"><a className="landing-btn landing-btn--primary" href="#planos">Ver planos e preços <Icon name="arrow" /></a><a className="landing-btn landing-btn--ghost" href="#como-funciona"><span className="landing-play"><Icon name="play" size={14} /></span> Ver como funciona</a></div><div className="landing-trust"><div className="landing-avatars"><span>LA</span><span>MS</span><span>RC</span><span>+8k</span></div><p><b>Mais tempo para criar.</b><br />Menos tempo entre abas e planilhas.</p></div></div><DashboardMock /></section>

    <section className="landing-network-strip"><div className="landing-container"><p>Conecte e gerencie as redes que fazem parte da sua estratégia</p><div className="landing-network-list"><span><PlatformIcon platform="instagram" className="landing-platform-icon" /> Instagram</span><span><PlatformIcon platform="facebook" className="landing-platform-icon" /> Facebook</span><span><PlatformIcon platform="youtube" className="landing-platform-icon" /> YouTube</span><span><PlatformIcon platform="tiktok" className="landing-platform-icon" /> TikTok</span></div></div></section>

    <section className="landing-platform-section landing-container" id="plataforma"><div className="landing-section-kicker">MEUECOOMÍDIA: VISÃO GERAL</div><h2>Uma plataforma inteira,<br /><em>em um só painel.</em></h2><p className="landing-platform-intro">Gerencie Instagram, Facebook, TikTok e YouTube sem alternar entre aplicativos. Planeje, publique, analise e converse com sua audiência no mesmo fluxo.</p>
    <div className="landing-capability-grid"><article className="landing-capability-card landing-capability-card--wide"><div className="landing-capability-copy"><FeatureIcon name="calendar" /><h3>Agendamento e publicação multiplataforma.</h3><p>Prepare posts, descrições e mídias, publique em todas as redes conectadas ou escolha os canais. O sistema adapta o conteúdo às regras de cada plataforma.</p><ul><li>Melhores horários sugeridos pela IA</li><li>Publicações recorrentes e duplicação de sucesso</li><li>Calendário com tudo programado</li></ul></div><PlatformScreenshot type="planner" /></article><article className="landing-capability-card"><div className="landing-capability-copy"><FeatureIcon name="folder" tone="pink" /><h3>Gestão de ativos.</h3><p>Guarde seus rascunhos</p></div><PlatformScreenshot type="assets" /></article><article className="landing-capability-card"><div className="landing-capability-copy"><FeatureIcon name="sparkle" tone="purple" /><h3>Assistente de IA avançado.</h3><p>Transforme uma ideia em posts prontos, peça ajustes em linguagem natural e receba leituras coerentes com o contexto do seu negócio.</p><ul><li>Baú de ideias com 3 sugestões</li><li>Análise visual, contextual e tradução de métricas</li></ul></div><PlatformScreenshot type="ai" /></article><article className="landing-capability-card landing-capability-card--wide"><div className="landing-capability-copy"><FeatureIcon name="chart" tone="blue" /><h3>Análise de desempenho e audiência.</h3><p>Monitore cada rede em uma visão unificada ou filtre por plataforma. Entenda quem é sua audiência e o que fazer em seguida.</p><ul><li>Dados demográficos e melhores dias e horários</li><li>Relatórios em PDF programados por e-mail</li></ul></div><PlatformScreenshot type="analytics" /></article><article className="landing-capability-card"><div className="landing-capability-copy"><FeatureIcon name="message" tone="pink" /><h3>Engajamento e conversão.</h3><p>Responda comentários do Instagram, Facebook e YouTube no Inbox e reúna seus links em uma página para a Bio.</p></div><PlatformScreenshot type="engagement" /></article><article className="landing-capability-card"><div className="landing-capability-copy"><FeatureIcon name="shield" tone="blue" /><h3>Segurança de alto nível.</h3><p>2FA, login via Google, gestão transparente das redes conectadas e chaves de acesso para integrações externas.</p></div><PlatformScreenshot type="security" /></article></div></section>

    <section className="landing-section landing-container" id="recursos"><div className="landing-section-kicker">TUDO EM UM SÓ LUGAR</div><h2>Da ideia ao resultado,<br /><em>sem perder o ritmo.</em></h2><p className="landing-section-intro">Uma plataforma feita para quem quer transformar presença digital em crescimento — sem complicação.</p><div className="landing-feature-grid"><article className="landing-feature landing-feature--featured"><div className="landing-feature-copy"><FeatureIcon name="calendar" /><h3>Planeje com clareza.<br />Publique no tempo certo.</h3><p>Organize seu calendário editorial e agende conteúdos para diferentes redes em poucos cliques.</p></div><CalendarMock /></article><article className="landing-feature"><FeatureIcon name="chart" tone="pink" /><h3>Entenda o que está funcionando.</h3><p>Relatórios claros, métricas por rede e leituras rápidas que transformam números em decisões.</p><div className="landing-stat-bars">{[42, 65, 52, 88, 74, 100].map((height, index) => <span style={{ height: `${height}%` }} key={index} />)}</div></article><article className="landing-feature"><FeatureIcon name="sparkle" tone="purple" /><h3>Crie melhor com apoio da IA.</h3><p>Gere ideias, refine legendas e receba insights para manter sua comunicação relevante.</p><div className="landing-ai-box"><span><Icon name="sparkle" size={16} /></span><p>Crie uma legenda envolvente para...</p><i /></div></article></div></section>

    <section className="landing-results" id="resultados"><div className="landing-container landing-results-grid"><div className="landing-result-copy"><div className="landing-section-kicker">DADOS QUE FALAM COM VOCÊ</div><h2>Relatórios de desempenho.<br /><em>Insights que fazem sentido.</em></h2><p>Visualize o desempenho de cada rede, compare períodos e descubra rapidamente onde estão as melhores oportunidades.</p><ul><li><Icon name="check" size={17} /> Métricas consolidadas em tempo real</li><li><Icon name="check" size={17} /> Comparação entre períodos e redes</li><li><Icon name="check" size={17} /> Recomendações práticas de próxima ação</li></ul></div><ReportMock /></div></section>

    <section className="landing-section landing-how-section landing-container" id="como-funciona"><div className="landing-section-kicker">COMECE SEM COMPLICAÇÃO</div><h2>Conecte. Organize. <em>Cresça.</em></h2><div className="landing-steps"><article><span>01</span><div className="landing-step-line" /><h3>Conecte suas redes</h3><p>Autorize seus perfis com segurança pelo fluxo oficial de cada plataforma.</p></article><article><span>02</span><div className="landing-step-line" /><h3>Organize seu conteúdo</h3><p>Crie, revise e agende publicações em um calendário único e visual.</p></article><article><span>03</span><div className="landing-step-line" /><h3>Acompanhe e evolua</h3><p>Veja os resultados, entenda os sinais e melhore sua estratégia continuamente.</p></article></div></section>

<section className="landing-section landing-plans landing-container" id="planos"><div className="landing-plans-heading"><div><div className="landing-section-kicker">PLANOS PARA CADA MOMENTO</div><h2>Escolha o plano ideal<br />para suas redes.</h2></div><p>Comece com o essencial e evolua quando sua presença digital crescer.</p></div><div className="landing-plans-grid">{plans.map(plan => <article className={`landing-plan${plan.featured ? ' is-popular' : ''}`} key={plan.id}>{plan.featured && <div className="landing-popular-badge">Mais escolhido</div>}<div className="landing-plan-top"><div><span>TIER {plan.tierNumber}</span>{plan.offer && <small className="landing-plan-offer">{plan.offer}</small>}{plan.meuEcooAccess !== 'none' && <a className="landing-plan-meuecoo-link" href="#plataforma">Conheça o MeuEcoo</a>}<h3>{plan.name.replace('EcooMidia ', 'EcooMidia\n')}</h3></div><div className="landing-plan-price"><strong>{plan.price}</strong><small>{plan.cadence}</small></div></div><p>{plan.description}</p><ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul><a className={`landing-plan-btn${plan.featured ? ' is-primary' : ''}`} href={`/criar-conta?plan=${plan.id}`}>Assinar {plan.name} <Icon name="arrow" size={15} /></a></article>)}</div></section>

    <section className="landing-contact" id="contato"><div className="landing-container landing-contact-inner"><Logo footer /><h2>Transforme sua rotina<br />nas redes sociais!</h2><p>Escolha o plano que combina com o momento da sua presença digital.</p><a className="landing-btn landing-btn--primary" href="#planos">Escolher meu plano <Icon name="arrow" /></a></div></section>
    <footer className="landing-footer"><div className="landing-container landing-footer-inner"><CopyrightNotice /><div><a href="/terms-of-service.html">Termos de uso</a><a href="/privacy-policy.html">Privacidade</a><a href="mailto:suporte@meuecoomidia.com.br">Contato</a></div></div></footer>
  </main>
}
