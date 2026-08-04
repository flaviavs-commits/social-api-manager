const getToken = () => localStorage.getItem('authToken')
// Em desenvolvimento o Vite usa o proxy local; em produção o front pode ser
// hospedado separadamente do backend (Vercel/Railway, por exemplo).
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function logout() {
  localStorage.removeItem('authToken')
  window.location.assign('/login.html')
}

export async function apiFetch(path, options = {}) {
  const { headers = {}, ...requestOptions } = options
  const authToken = getToken()
  const response = await fetch(`${API_URL}${path}`, {
    ...requestOptions,
    headers: {
      ...(requestOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
  })

  if (response.status === 401) {
    logout()
    throw new ApiError('Sessão expirada', response.status)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(body.erro || 'Não foi possível concluir a operação', response.status)
  }

  return response.status === 204 ? null : response.json()
}
