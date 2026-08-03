// Cliente para a API do Zernio (docs.zernio.com) — API unificada de terceiros
// usada para Facebook/Instagram/TikTok no lugar da integração OAuth direta
// com cada plataforma. O Zernio detém o token OAuth real; aqui só chamamos a
// API deles com nossa própria API key.
//
// Formato de erro observado em teste real (2026-08-03) não bate 100% com a
// doc pública: às vezes só { error }, às vezes { error, type, code } — nunca
// confiar em type/code estarem presentes, só error é garantido.
const ZERNIO_BASE_URL = 'https://zernio.com/api/v1'

class ZernioError extends Error {
  constructor(message, { status, code, type, details } = {}) {
    super(message)
    this.name = 'ZernioError'
    this.status = status
    this.code = code
    this.type = type
    this.details = details
  }
}

function apiKey() {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error('ZERNIO_API_KEY não configurada no .env')
  return key
}

// Retry em 5xx/429 — mesmo espírito do fetchJsonWithRetry usado em
// src/routes/oauth.js para as outras redes. Respeita Retry-After quando
// presente (documentado pelo Zernio nos headers de rate limit).
async function zernioFetch(path, { method = 'GET', body, query, retries = 2, delayMs = 600 } = {}) {
  const url = new URL(ZERNIO_BASE_URL + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v)
    }
  }

  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch (err) {
      lastErr = err
      if (attempt < retries) { await new Promise(r => setTimeout(r, delayMs * (attempt + 1))); continue }
      throw err
    }

    const contentType = res.headers.get('content-type') || ''
    // Algumas rotas documentadas como API (ex.: /webhooks) na prática
    // devolvem o HTML do dashboard do Zernio em vez de JSON — trata como
    // erro claro em vez de tentar parsear HTML como JSON.
    if (!contentType.includes('application/json')) {
      throw new ZernioError(`Resposta inesperada do Zernio (content-type: ${contentType || 'desconhecido'}) — endpoint pode não existir via API`, { status: res.status })
    }

    const data = await res.json().catch(() => null)

    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after')) || (delayMs * (attempt + 1) / 1000)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      continue
    }
    if (res.status >= 500 && attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
      continue
    }

    if (!res.ok) {
      throw new ZernioError(data?.error || `Zernio respondeu ${res.status}`, {
        status: res.status, code: data?.code, type: data?.type, details: data?.details
      })
    }

    return data
  }
  throw lastErr
}

// Devolve a URL de autorização OAuth para o usuário conectar uma conta —
// platform: 'facebook' | 'instagram' | 'tiktok' (confirmado em teste real,
// minúsculo, mesmos nomes usados internamente em contas.platform).
// redirectUrl: parâmetro NÃO documentado publicamente mas confirmado
// funcional em teste real — sem ele, o Zernio manda o usuário de volta para
// o próprio dashboard deles ao final do OAuth, não para o nosso site.
async function connectUrl(platform, profileId, redirectUrl) {
  return zernioFetch(`/connect/${platform}`, { query: { profileId, redirectUrl } })
}

async function listAccounts() {
  return zernioFetch('/accounts')
}

async function getAccountHealth(accountId) {
  return zernioFetch(`/accounts/${accountId}/health`)
}

async function disconnectAccount(accountId) {
  return zernioFetch(`/accounts/${accountId}`, { method: 'DELETE' })
}

async function listProfiles() {
  return zernioFetch('/profiles')
}

async function createPost(body) {
  return zernioFetch('/posts', { method: 'POST', body })
}

async function getPost(postId) {
  return zernioFetch(`/posts/${postId}`)
}

module.exports = {
  ZernioError,
  connectUrl, listAccounts, getAccountHealth, disconnectAccount, listProfiles,
  createPost, getPost
}
