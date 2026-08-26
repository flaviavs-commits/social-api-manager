const crypto = require('crypto')
const webhooksRepo = require('../repositories/zernioWebhooksRepository')
const zernioClient = require('../infra/social/zernioClient')
const postsRepo = require('../infra/db/postsRepository')
const { confirmarPublicacaoZernio } = require('../infra/social/publisher')

const ROLLUP_EVENTS = new Set(['post.published', 'post.failed', 'post.partial'])
const PLATFORM_EVENTS = new Set(['post.platform.published', 'post.platform.failed'])
const HANDLED_EVENTS = new Set([...ROLLUP_EVENTS, ...PLATFORM_EVENTS, 'webhook.test'])

function header(headers, name) {
  const wanted = name.toLowerCase()
  const key = Object.keys(headers || {}).find(candidate => candidate.toLowerCase() === wanted)
  const value = key ? headers[key] : null
  return Array.isArray(value) ? value[0] : value
}

function verifySignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false
  if (!/^[a-f0-9]{64}$/i.test(String(signature))) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest()
  const received = Buffer.from(String(signature), 'hex')
  return received.length === expected.length && crypto.timingSafeEqual(received, expected)
}

function platformName(value) {
  if (!value) return null
  if (typeof value === 'string') return value.toLowerCase()
  const nested = typeof value.platform === 'object' ? value.platform : null
  return String(
    value.platformName || value.name ||
    (typeof value.platform === 'string' ? value.platform : null) ||
    nested?.name || nested?.platform || ''
  ).trim().toLowerCase() || null
}

function objectId(value) {
  if (!value || typeof value !== 'object') return null
  return value.accountId || value.zernioAccountId || value._id || value.id || null
}

function entryAccountId(value) {
  if (!value || typeof value !== 'object') return null
  return value.accountId || value.zernioAccountId || objectId(value.account) || null
}

function providerPostId(payload) {
  const post = payload?.post || payload?.data?.post
  return post?._id || post?.zernioPostId || post?.postId || post?.id || payload?.zernioPostId || payload?.postId || null
}

function postFromPayload(payload) {
  return payload?.post || payload?.data?.post || null
}

function platformEntries(post) {
  if (Array.isArray(post?.platforms)) return post.platforms
  if (post?.platforms && typeof post.platforms === 'object') return Object.values(post.platforms)
  return []
}

function externalPostId(entry) {
  return entry?.platformPostId || entry?.externalPostId || entry?.platform?.platformPostId || entry?.platform?.postId || null
}

function entryStatus(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.success === 'boolean') return entry.success ? 'published' : 'failed'
  return String(entry.status || entry.state || entry.result || '').trim().toLowerCase() || null
}

function isPublishedStatus(status) {
  return ['published', 'success', 'succeeded', 'completed', 'complete', 'done'].includes(status)
}

function isFailedStatus(status) {
  return ['failed', 'failure', 'error', 'erro', 'cancelled', 'canceled'].includes(status)
}

function entryError(entry, post, payload) {
  return entry?.errorMessage || entry?.error || entry?.failureReason || post?.errorMessage || payload?.errorMessage || payload?.error || null
}

function matchingEntry(entries, line, eventPlatform, eventAccountId) {
  const samePlatform = entries.filter(entry => platformName(entry) === line.platform)
  if (!samePlatform.length) return null
  const wantedAccount = eventAccountId ? String(eventAccountId) : null
  return samePlatform.find(entry => {
    const id = entryAccountId(entry)
    return wantedAccount && id ? String(id) === wantedAccount : !wantedAccount
  }) || samePlatform[0]
}

async function processarPayload(payload) {
  const eventName = String(payload?.event || '').trim().toLowerCase()
  if (!HANDLED_EVENTS.has(eventName) || eventName === 'webhook.test') return { matched: 0 }

  const zernioPostId = providerPostId(payload)
  if (!zernioPostId) return { matched: 0 }

  let post = postFromPayload(payload)
  let entries = platformEntries(post)
  // O rollup parcial precisa da situação de cada plataforma para distinguir
  // sucesso de falha. Se o payload vier reduzido, consulta o post uma vez.
  if (eventName === 'post.partial' && !entries.length) {
    const response = await zernioClient.getPost(zernioPostId)
    post = response?.post || response || post
    entries = platformEntries(post)
  }

  const pending = await postsRepo.listarPostsComZernioPendentePorPostId(zernioPostId)
  if (!pending.length) return { matched: 0 }

  const eventPlatform = PLATFORM_EVENTS.has(eventName) ? platformName(payload.platform) : null
  const eventAccountId = PLATFORM_EVENTS.has(eventName) ? objectId(payload.account) : null
  let matched = 0

  for (const line of pending) {
    if (eventPlatform && line.platform !== eventPlatform) continue
    const entry = matchingEntry(entries, line, eventPlatform, eventAccountId)
    let success = null

    if (eventName === 'post.platform.published' || eventName === 'post.published') success = true
    if (eventName === 'post.platform.failed' || eventName === 'post.failed') success = false
    if (eventName === 'post.partial') {
      const status = entryStatus(entry)
      if (isPublishedStatus(status)) success = true
      if (isFailedStatus(status)) success = false
      // Cada chamada atual do nosso publisher tem um único alvo no Zernio.
      // Se o provedor mandar um rollup parcial sem detalhamento, não inventa
      // sucesso: o alvo local é tratado como falha e fica visível ao usuário.
      if (success === null && pending.length === 1 && !entries.length) success = false
    }

    if (success === null) continue
    const eventEntry = entry || payload.platform || {}
    const result = await confirmarPublicacaoZernio({
      zernioPostId,
      platform: line.platform,
      zernioAccountId: eventAccountId || entryAccountId(eventEntry),
      success,
      externalPostId: externalPostId(eventEntry),
      publishedAt: eventEntry.publishedAt || payload.timestamp || new Date().toISOString(),
      error: success ? null : entryError(eventEntry, post, payload)
    })
    matched += result.matched || 0
  }

  return { matched }
}

async function receber({ rawBody, headers }) {
  const secret = String(process.env.ZERNIO_WEBHOOK_SECRET || '').trim()
  if (!secret) return { status: 503, body: { erro: 'Webhook da Zernio não configurado.' } }

  const signature = header(headers, 'X-Zernio-Signature') || header(headers, 'X-Late-Signature')
  if (!signature) return { status: 401, body: { erro: 'Assinatura do webhook ausente.' } }
  if (!verifySignature(rawBody, signature, secret)) return { status: 400, body: { erro: 'Assinatura do webhook inválida.' } }

  let payload
  try { payload = JSON.parse(rawBody.toString('utf8')) } catch {
    return { status: 400, body: { erro: 'Corpo do webhook inválido.' } }
  }

  const bodyEventId = payload?.id ? String(payload.id) : null
  const headerEventId = header(headers, 'X-Zernio-Event-Id') || header(headers, 'X-Late-Event-Id')
  if (bodyEventId && headerEventId && bodyEventId !== String(headerEventId)) {
    return { status: 400, body: { erro: 'Identificador do webhook inconsistente.' } }
  }
  const eventId = bodyEventId || (headerEventId ? String(headerEventId) : null)
  const eventName = String(payload?.event || '').trim()
  if (!eventId || !eventName) return { status: 400, body: { erro: 'Webhook sem id ou evento.' } }

  const queued = await webhooksRepo.enfileirar({ eventId, eventName, payload })
  return {
    status: 200,
    body: { received: true, duplicate: !queued },
    eventRowId: queued?.id || null
  }
}

async function processarZernioWebhook(id) {
  const event = await webhooksRepo.reservar(id)
  if (!event) return { processed: false }
  try {
    const result = await processarPayload(event.payload)
    await webhooksRepo.marcarProcessado(id)
    return { processed: true, ...result }
  } catch (error) {
    await webhooksRepo.devolverParaFila(id, error)
    throw error
  }
}

async function processarZernioWebhooksPendentes() {
  const events = await webhooksRepo.listarPendentes(50)
  for (const event of events) {
    await processarZernioWebhook(event.id).catch(error => {
      console.error(`[zernio-webhook] falha ao processar ${event.eventId}:`, error.message)
    })
  }
}

module.exports = {
  HANDLED_EVENTS,
  verifySignature,
  processarPayload,
  receber,
  processarZernioWebhook,
  processarZernioWebhooksPendentes
}
