export function LoadingState({ children = 'Carregando...' }) {
  return <div className="loading-state" aria-live="polite"><span className="loading-skeleton-dot" aria-hidden="true" />{children}</div>
}
