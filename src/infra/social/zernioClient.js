// Cliente para a API do Zernio (docs.zernio.com) — API unificada de terceiros
// usada para Facebook/Instagram/TikTok/YouTube no lugar da integração OAuth direta
// com cada plataforma. O Zernio detém o token OAuth real; aqui só chamamos a
// API deles com nossa própria API key.
//
// Formato de erro observado em teste real (2026-08-03) não bate 100% com a
// doc pública: às vezes só { error }, às vezes { error, type, code } — nunca
// confiar em type/code estarem presentes, só error é garantido.
const ZERNIO_BASE_URL = 'https://zernio.com/api/v1'
const { HttpClientError, requestJson } = require('../http/requestJson')

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
async function zernioFetch(path, { method = 'GET', body, query, headers = {}, timeoutMs = 10_000, retries = 2, delayMs = 600 } = {}) {
  const url = new URL(ZERNIO_BASE_URL + path)
  try {
    return await requestJson(url, {
      method,
      query,
      body,
      timeoutMs,
      headers: { Authorization: `Bearer ${apiKey()}`, ...headers },
      retries,
      retryDelayMs: delayMs
    })
  } catch (error) {
    if (error instanceof ZernioError) throw error
    if (error instanceof HttpClientError) {
      throw new ZernioError(error.message, {
        status: error.status,
        details: error.data
      })
    }
    throw error
  }
}

// Devolve a URL de autorização OAuth para o usuário conectar uma conta —
// platform: 'facebook' | 'instagram' | 'tiktok' | 'youtube' (confirmado em teste real,
// minúsculo, mesmos nomes usados internamente em contas.platform).
// redirectUrl: parâmetro NÃO documentado publicamente mas confirmado
// funcional em teste real — sem ele, o Zernio manda o usuário de volta para
// o próprio dashboard deles ao final do OAuth, não para o nosso site.
async function connectUrl(platform, profileId, redirectUrl, { headless = false } = {}) {
  // A documentação atual usa redirect_url. Enviar também o nome antigo
  // (redirectUrl) pode fazer versões diferentes da API escolherem destinos
  // distintos; usamos apenas o parâmetro oficial.
  return zernioFetch(`/connect/${platform}`, { query: { profileId, redirect_url: redirectUrl, ...(headless ? { headless: true } : {}) } })
}

async function listAccounts({ profileId, platform, includeOverLimit = false } = {}) {
  return zernioFetch('/accounts', { query: { profileId, platform, ...(includeOverLimit ? { includeOverLimit: true } : {}) } })
}

async function listFacebookPages(profileId, tempToken, connectToken) {
  return zernioFetch('/connect/facebook/select-page', {
    query: { profileId, tempToken },
    headers: connectToken ? { 'X-Connect-Token': connectToken } : {}
  })
}

async function selectFacebookPage(body, connectToken) {
  return zernioFetch('/connect/facebook/select-page', {
    method: 'POST',
    body,
    headers: connectToken ? { 'X-Connect-Token': connectToken } : {}
  })
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

// Inbox de comentários do Zernio. Facebook/Instagram conectados via Zernio
// não entregam um access token da Meta para a nossa aplicação; o Zernio é quem
// autentica na rede social e exige o accountId da conta conectada.
async function getPostComments(postId, query, requestOptions = {}) {
  return zernioFetch(`/inbox/comments/${encodeURIComponent(postId)}`, { query, ...requestOptions })
}

async function replyToComment(postId, body) {
  return zernioFetch(`/inbox/comments/${encodeURIComponent(postId)}`, { method: 'POST', body })
}

// Relatórios de analytics são mantidos como métodos explícitos para que a
// camada de serviço não conheça paths nem detalhes de autenticação do Zernio.
// O parâmetro query é opcional para preservar o contrato usado pelo fluxo
// legado de reconciliação.
async function getAnalytics(query) {
  return zernioFetch('/analytics', { query })
}

async function getDailyMetrics(query) {
  return zernioFetch('/analytics/daily-metrics', { query })
}

async function getContentDecay(query) {
  return zernioFetch('/analytics/content-decay', { query })
}

async function getBestTimeToPost(query) {
  return zernioFetch('/analytics/best-time', { query })
}

async function getPostTimeline(query) {
  return zernioFetch('/analytics/post-timeline', { query })
}

async function getFollowerStats(query) {
  return zernioFetch('/accounts/follower-stats', { query })
}

async function getFacebookPageInsights(query) {
  return zernioFetch('/analytics/facebook/page-insights', { query })
}

async function getInstagramAccountInsights(query) {
  return zernioFetch('/analytics/instagram/account-insights', { query })
}

async function getInstagramDemographics(query) {
  return zernioFetch('/analytics/instagram/demographics', { query })
}

async function getTiktokAccountInsights(query) {
  return zernioFetch('/analytics/tiktok/account-insights', { query })
}

async function getYoutubeChannelInsights(query) {
  return zernioFetch('/analytics/youtube/channel-insights', { query })
}

async function getYoutubeDailyViews(query) {
  return zernioFetch('/analytics/youtube/daily-views', { query })
}

async function getYoutubeVideoRetention(query) {
  return zernioFetch('/analytics/youtube/video-retention', { query })
}

async function getYoutubeDemographics(query) {
  return zernioFetch('/analytics/youtube/demographics', { query })
}

async function getFacebookPostReactions(accountId, query) {
  return zernioFetch(`/accounts/${encodeURIComponent(accountId)}/facebook-post-reactions`, { query })
}

async function getYoutubePlaylists(accountId) {
  return zernioFetch(`/accounts/${encodeURIComponent(accountId)}/youtube-playlists`)
}

module.exports = {
  ZernioError,
  connectUrl, listAccounts, listFacebookPages, selectFacebookPage, getAccountHealth, disconnectAccount, listProfiles,
  createPost, getPost, getAnalytics, getDailyMetrics, getContentDecay, getBestTimeToPost, getPostTimeline,
  getPostComments, replyToComment,
  getFollowerStats, getFacebookPageInsights, getInstagramAccountInsights,
  getInstagramDemographics, getTiktokAccountInsights, getYoutubeChannelInsights,
  getYoutubeDailyViews, getYoutubeVideoRetention, getYoutubeDemographics,
  getFacebookPostReactions, getYoutubePlaylists
}
