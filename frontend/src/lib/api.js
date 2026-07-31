const token = () => localStorage.getItem('authToken')
export async function apiFetch(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...options.headers } })
  if (response.status === 401) { window.location.href = '/login.html'; throw new Error('Sessão expirada') }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).erro || 'Não foi possível concluir a operação')
  return response.status === 204 ? null : response.json()
}
