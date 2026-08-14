import { SiteHeader } from '../components/layout/site-header.jsx'
import { Card } from '../components/ui/card.jsx'
import { PlatformList } from '../sections/platform-list.jsx'
import { PLANS } from '../lib/plans.js'
import { CopyrightNotice } from '../components/ui/copyright-notice.jsx'

const TIERS = Object.values(PLANS).map(plan => ({
  ...plan,
  cta: plan.id === 'gratuito' ? 'Começar grátis' : `Escolher ${plan.name}`,
  featured: plan.id === 'criador',
}))

export function LandingPage() {
  return <main className="page-shell"><div className="page-container"><SiteHeader /><section className="hero"><p className="eyebrow">GERENCIAMENTO SOCIAL</p><h1>Gerencie suas redes sociais em um só lugar</h1><p className="hero-copy">Agende, publique e acompanhe o desempenho do seu conteúdo em várias redes sociais a partir de uma única interface.</p><div className="hero-actions"><a className="felixo-button felixo-button--primary" href="#planos">Conhecer os planos</a><a className="hero-secondary-link" href="/criar-conta">Criar minha conta <span aria-hidden="true">→</span></a></div></section><section className="tiers-section" id="planos" aria-labelledby="tiers-title"><div className="section-heading"><div><p className="eyebrow">PLANOS PARA CADA MOMENTO</p><h2 id="tiers-title">Escolha o ritmo do seu conteúdo</h2></div><p>Comece pelo tier que combina com você. O cadastro leva menos de um minuto.</p></div><div className="tier-grid">{TIERS.map(tier => <article className={`tier-card${tier.featured ? ' tier-card--featured' : ''}`} key={tier.id}>{tier.featured && <span className="tier-badge">Mais escolhido</span>}<div className="tier-card-heading"><div><p className="tier-kicker">TIER {String(TIERS.indexOf(tier) + 1).padStart(2, '0')}</p><h3>{tier.name}</h3></div><span className="tier-price">{tier.price}</span></div><p className="tier-description">{tier.description}</p><ul className="tier-features">{tier.features.map(feature => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul><a className={`tier-cta${tier.featured ? ' tier-cta--primary' : ''}`} href={`/criar-conta?plan=${tier.id}`}>{tier.cta}<span aria-hidden="true">→</span></a></article>)}</div></section><div className="content-grid"><Card title="O que o aplicativo faz"><p>Conecte suas contas, crie um post uma única vez e escolha em quais plataformas ele deve ser publicado, imediatamente ou em uma data agendada.</p><PlatformList /></Card><Card title="Como funciona"><ol className="steps"><li>Escolha seu tier e crie sua conta.</li><li>Conecte as redes sociais pelo fluxo oficial de autorização.</li><li>Publique e acompanhe status e métricas no painel.</li></ol></Card></div><footer className="site-footer"><a href="/support">Suporte</a><a href="/privacy-policy">Política de Privacidade</a><a href="/terms-of-service">Termos de Uso</a><CopyrightNotice /></footer></div></main>
}
