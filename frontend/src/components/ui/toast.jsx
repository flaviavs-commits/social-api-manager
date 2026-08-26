import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const notify = useCallback((message, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(current => [...current, { id, message, type }])
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 4200)
  }, [])

  return <ToastContext.Provider value={notify}>
    {children}
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map(toast => <div className={`toast toast-${toast.type}`} key={toast.id} role={toast.type === 'error' ? 'alert' : 'status'}><span aria-hidden="true">{toast.type === 'error' || toast.type === 'warning' ? '!' : '✓'}</span>{toast.message}</div>)}
    </div>
  </ToastContext.Provider>
}

export function useToast() {
  const notify = useContext(ToastContext)
  if (!notify) throw new Error('useToast precisa estar dentro de ToastProvider')
  return notify
}
