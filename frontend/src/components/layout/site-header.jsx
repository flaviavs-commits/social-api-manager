import { Button } from '../ui/button.jsx'

export function SiteHeader() {
  return <header className="site-header"><a className="brand" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/favicon.svg" alt="" /> <span>Meu Ecoo Mídia</span></a><Button href="/login.html">Entrar</Button></header>
}
