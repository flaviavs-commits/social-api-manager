import { SiteHeader } from '../components/layout/site-header.jsx'
import { Card } from '../components/ui/card.jsx'
import { PlatformList } from '../sections/platform-list.jsx'

export function LandingPage() {
  return <main className="page-shell"><div className="page-container"><SiteHeader /><section className="hero"><p className="eyebrow">GERENCIAMENTO SOCIAL</p><h1>Gerencie suas redes sociais em um só lugar</h1><p className="hero-copy">Agende, publique e acompanhe o desempenho do seu conteúdo em várias redes sociais a partir de uma única interface.</p></section><div className="content-grid"><Card title="O que o aplicativo faz"><p>Conecte suas contas, crie um post uma única vez e escolha em quais plataformas ele deve ser publicado, imediatamente ou em uma data agendada.</p><PlatformList /></Card><Card title="Como funciona"><ol className="steps"><li>Crie sua conta com e-mail e senha.</li><li>Conecte as redes sociais pelo fluxo oficial de autorização.</li><li>Publique e acompanhe status e métricas no painel.</li></ol></Card></div><footer className="site-footer"><a href="/support">Suporte</a><a href="/privacy-policy">Política de Privacidade</a><a href="/terms-of-service">Termos de Uso</a></footer></div></main>
}
