import { Button } from '../ui/button.jsx'
import { ThemeSelector } from '../ui/theme-selector.jsx'

export function SiteHeader() {
  return <header className="site-header"><a className="brand" href="/" aria-label="Meu Ecoo Mídia - início"><img src="/logo.svg" alt="Meu Ecoo Mídia" /></a><div className="site-header-actions"><ThemeSelector /><Button href="/login.html">Entrar</Button><Button href="/criar-conta">Criar conta</Button></div></header>
}
