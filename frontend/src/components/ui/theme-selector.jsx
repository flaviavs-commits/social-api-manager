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
    <button type="button" className={theme === 'light' ? 'is-active' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
      <span aria-hidden="true">☀</span><span>Claro</span>
    </button>
    <button type="button" className={theme === 'dark' ? 'is-active' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
      <span aria-hidden="true">☾</span><span>Escuro</span>
    </button>
  </div>
}
