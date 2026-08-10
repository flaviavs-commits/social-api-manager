// Em desenvolvimento o Vite usa o proxy local; em produção o front pode ser
// hospedado separadamente do backend (Vercel/Railway, por exemplo).
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function logout() {
  void fetch(`${API_URL}/auth/login/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
  window.location.assign('/login.html')
}

function parseBody(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return { mensagem: text } }
}

function errorMessage(body, fallback) {
  return body?.erro || body?.message || body?.mensagem || fallback
}

async function request(path, options = {}) {
  const { headers = {}, timeoutMs = 15_000, ...requestOptions } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...requestOptions,
      credentials: 'include',
      signal: requestOptions.signal || controller.signal,
      headers: {
        ...(requestOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
    })

    const body = response.status === 204 ? null : parseBody(await response.text())
    return { response, body }
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('Tempo esgotado. Verifique sua conexão e tente novamente.', 408)
    throw new ApiError('Não foi possível conectar ao servidor.', 0)
  } finally {
    clearTimeout(timer)
  }
}

export async function publicApiFetch(path, options = {}) {
  const { response, body } = await request(path, options)
  if (!response.ok) throw new ApiError(errorMessage(body, 'Não foi possível concluir a operação'), response.status)
  return body
}

export async function apiFetch(path, options = {}) {
  const { response, body } = await request(path, options)

  if (response.status === 401) {
    logout()
    throw new ApiError('Sessão expirada', response.status)
  }

  if (!response.ok) {
    throw new ApiError(errorMessage(body, 'Não foi possível concluir a operação'), response.status)
  }

  return body
}
