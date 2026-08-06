class HttpClientError extends Error {
  constructor(message, { status = 0, data = null, url = '' } = {}) {
    super(message)
    this.name = 'HttpClientError'
    this.status = status
    this.data = data
    this.url = url
  }
}

function retryAfterMs(response, fallback) {
  const value = Number(response.headers?.get?.('retry-after'))
  return Number.isFinite(value) && value >= 0 ? value * 1000 : fallback
}

function errorMessage(data, status) {
  if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 500)
  if (typeof data?.error === 'string') return data.error
  if (data?.error?.message) return data.error.message
  if (data?.message) return data.message
  return `HTTP ${status}`
}

async function parseResponse(response) {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

async function requestJson(url, {
  method = 'GET',
  headers = {},
  query,
  body,
  timeoutMs = 10_000,
  retries = 2,
  retryDelayMs = 250,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch não está disponível neste ambiente')

  const target = new URL(url)
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value))
  }

  const requestHeaders = { Accept: 'application/json', ...headers }
  let serializedBody = body
  if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
    serializedBody = JSON.stringify(body)
    if (!Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-type')) {
      requestHeaders['Content-Type'] = 'application/json'
    }
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response
    try {
      response = await fetchImpl(target, {
        method,
        headers: requestHeaders,
        body: serializedBody,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      lastError = error.name === 'TimeoutError' || error.name === 'AbortError'
        ? new HttpClientError(`Tempo esgotado ao acessar ${target.origin}`, { url: target.toString() })
        : error
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)))
        continue
      }
      throw lastError
    }

    const data = await parseResponse(response)
    const retryable = response.status === 429 || response.status >= 500
    if (!response.ok) {
      if (retryable && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryAfterMs(response, retryDelayMs * (attempt + 1))))
        continue
      }
      throw new HttpClientError(errorMessage(data, response.status), {
        status: response.status,
        data,
        url: target.toString()
      })
    }

    if (typeof data === 'string' && !String(response.headers?.get?.('content-type') || '').includes('json')) {
      throw new HttpClientError('Resposta externa não é um JSON válido', { status: response.status, data, url: target.toString() })
    }
    return data
  }

  throw lastError || new HttpClientError('Falha na requisição externa', { url: target.toString() })
}

module.exports = { HttpClientError, requestJson }
