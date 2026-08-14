export function CopyrightNotice({ className = '' }) {
  const year = new Date().getFullYear()
  return <small className={`copyright-notice${className ? ` ${className}` : ''}`}>© {year} Meu Ecoo Mídia. Todos os direitos reservados.</small>
}
