export function Button({ children, href, variant = 'primary', size = 'md', className: customClassName = '', type = 'button', ...props }) {
  const className = ['felixo-button', `felixo-button--${variant}`, `felixo-button--${size}`, customClassName].filter(Boolean).join(' ')
  return href ? <a className={className} href={href} {...props}>{children}</a> : <button type={type} className={className} {...props}>{children}</button>
}
