export function Button({ children, href, variant = 'primary' }) {
  const className = `felixo-button felixo-button--${variant}`
  return href ? <a className={className} href={href}>{children}</a> : <button className={className}>{children}</button>
}
