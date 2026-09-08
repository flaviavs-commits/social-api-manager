import { useEffect, useState } from 'react'

export const THEME_STORAGE_KEY = 'meu-ecoo:theme:v2'

export function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = nextTheme
  document.documentElement.style.colorScheme = nextTheme
  return nextTheme
}

export function useTheme() {
  const [theme, setTheme] = useState(getStoredTheme)

  useEffect(() => {
    const handleThemeChange = event => setTheme(event.detail === 'light' ? 'light' : 'dark')
    window.addEventListener('meu-ecoo:themechange', handleThemeChange)
    return () => window.removeEventListener('meu-ecoo:themechange', handleThemeChange)
  }, [])

  return theme
}

// Botão único (alterna claro/escuro num clique) para superfícies fora do
// app autenticado, como a landing page — usa o mesmo mecanismo de
// persistência e o mesmo evento global do ThemeSelector, então o tema
// escolhido aqui também vale para o app quando a pessoa entrar.
export function ThemeToggleButton({ className = '' }) {
  const [theme, setTheme] = useState(getStoredTheme)

  useEffect(() => {
    const nextTheme = applyTheme(theme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // A preferência continua funcionando mesmo quando o storage está indisponível.
    }
    window.dispatchEvent(new CustomEvent('meu-ecoo:themechange', { detail: nextTheme }))
  }, [theme])

  useEffect(() => {
    const handleThemeChange = event => setTheme(event.detail === 'light' ? 'light' : 'dark')
    window.addEventListener('meu-ecoo:themechange', handleThemeChange)
    return () => window.removeEventListener('meu-ecoo:themechange', handleThemeChange)
  }, [])

  const isLight = theme === 'light'
  return <button
    type="button"
    className={`theme-toggle-button${className ? ` ${className}` : ''}`}
    onClick={() => setTheme(isLight ? 'dark' : 'light')}
    aria-pressed={isLight}
    aria-label={isLight ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'}
    title={isLight ? 'Tema escuro' : 'Tema claro'}
  >
    <span aria-hidden="true">{isLight ? '☾' : '☀'}</span>
  </button>
}

export function ThemeSelector() {
  const [theme, setTheme] = useState(getStoredTheme)

  useEffect(() => {
    const nextTheme = applyTheme(theme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // A preferência continua funcionando mesmo quando o storage está indisponível.
    }
    window.dispatchEvent(new CustomEvent('meu-ecoo:themechange', { detail: nextTheme }))
  }, [theme])

  return <div className="theme-selector" data-tutorial-target="tema" role="group" aria-label="Tema da interface">
    <button type="button" className={theme === 'light' ? 'is-active' : ''} aria-pressed={theme === 'light'} aria-label="Tema claro" title="Tema claro" onClick={() => setTheme('light')}>
      <span className="theme-option-icon" aria-hidden="true">☀</span><span className="theme-option-label">Claro</span>
    </button>
    <button type="button" className={theme === 'dark' ? 'is-active' : ''} aria-pressed={theme === 'dark'} aria-label="Tema escuro" title="Tema escuro" onClick={() => setTheme('dark')}>
      <span className="theme-option-icon" aria-hidden="true">☾</span><span className="theme-option-label">Escuro</span>
    </button>
  </div>
}
