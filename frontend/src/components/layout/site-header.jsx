import { Button } from '../ui/button.jsx'

export function SiteHeader() {
  return <header className="site-header"><a className="brand" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/logo.svg" alt="Meu Ecoo Mídia" /></a><Button href="/login.html">Entrar</Button></header>
}
