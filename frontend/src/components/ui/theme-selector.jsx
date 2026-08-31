import { useEffect, useState } from 'react'

export const THEME_STORAGE_KEY = 'meu-ecoo:theme:v2'

export function getStoredTheme() {
  return 'light'
}

export function applyTheme() {
  const nextTheme = 'light'
  document.documentElement.dataset.theme = nextTheme
  document.documentElement.classList.add('light-mode-forced')
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

// Indicador de tema para superfícies fora do app autenticado, como a landing
// page. O projeto inteiro permanece permanentemente no modo claro.
export function ThemeToggleButton({ className = '' }) {
  return <button
    type="button"
    className={`theme-toggle-button${className ? ` ${className}` : ''}`}
    aria-pressed="true"
    aria-label="Modo claro ativo"
    title="Modo claro ativo"
  >
    <span aria-hidden="true">☀</span>
  </button>
}

export function ThemeSelector() {
  useEffect(() => {
    const nextTheme = applyTheme()
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // A preferência continua funcionando mesmo quando o storage está indisponível.
    }
    window.dispatchEvent(new CustomEvent('meu-ecoo:themechange', { detail: nextTheme }))
  }, [])

  return <div className="theme-selector" data-tutorial-target="tema" role="group" aria-label="Tema da interface">
    <button type="button" className="is-active" aria-pressed="true" aria-label="Modo claro ativo">
      <span aria-hidden="true">☀</span><span>Claro</span>
    </button>
  </div>
}
