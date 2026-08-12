const pool = require('../db/pool')
const { decrypt } = require('./tokenCrypto')
const { registrarLog, broadcastEvent } = require('../repositories/logsRepository')
const zernioClient = require('../infra/social/zernioClient')

// Quantas falhas seguidas até considerar a plataforma "fora do ar". Evita
// marcar como down por causa de uma falha isolada de rede (flakiness).
const FAIL_THRESHOLD = 2

const PLATFORMS = ['instagram', 'facebook', 'youtube', 'tiktok']

// Facebook/Instagram/TikTok/YouTube publicam via Zernio agora — o access_token
// guardado para essas contas não é mais um token real da Graph API/Content
// Posting API, é o accountId do Zernio (ver src/routes/oauth.js,
// syncZernioAccount), então a sonda de saúde chama a API deles em vez de
// bater direto na rede social.
const PLATAFORMAS_VIA_ZERNIO = ['instagram', 'facebook', 'tiktok', 'youtube']

// Chamada leve (não conta como publicação) só para verificar se a API da
// plataforma está respondendo, usando o token/accountId de uma conta
// conectada qualquer como sonda.
async function pingPlatform(platform, accessToken) {
  if (PLATAFORMAS_VIA_ZERNIO.includes(platform)) {
    try {
      // accessToken aqui é o zernio_account_id (ver buscarTokenSonda).
      const health = await zernioClient.getAccountHealth(accessToken)
      // status "healthy"/"degraded"/"disconnected" observados em teste real
      // — só "disconnected" (token realmente inválido no Zernio) conta como
      // falha de disponibilidade; degraded ainda posta.
      return { ok: health?.status !== 'disconnected', message: health?.status }
    } catch (err) {
      return { ok: false, message: err.message || 'erro ao consultar saúde no Zernio' }
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    let url
    if (platform === 'youtube') {
      url = `https://www.googleapis.com/youtube/v3/channels?part=id&mine=true`
    } else {
      return { ok: false, message: 'plataforma desconhecida' }
    }

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal })

    // 401/403 = token inválido, não é a API estar fora do ar — não conta como falha de disponibilidade
    if (res.status === 401 || res.status === 403) return { ok: true }
    if (res.status >= 500) return { ok: false, message: `HTTP ${res.status}` }

    await res.json().catch(() => null)
    return { ok: true }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, message: 'timeout' }
    return { ok: false, message: err.message || 'erro de rede' }
  } finally {
    clearTimeout(timeout)
  }
}

async function buscarTokenSonda(platform) {
  // Para redes via Zernio, zernio_account_id é o identificador certo a usar
  // (access_token guardado é só um espelho opaco do mesmo valor, ver
  // src/routes/oauth.js/syncZernioAccount) — busca direto da coluna dedicada
  // para não depender de decifrar o "access_token" fake.
  if (PLATAFORMAS_VIA_ZERNIO.includes(platform)) {
    const { rows } = await pool.query(`
      SELECT c.zernio_account_id AS "zernioAccountId"
      FROM tokens t JOIN contas c ON c.id = t.conta_id
      WHERE t.platform = $1 AND t.status != 'expired' AND c.zernio_account_id IS NOT NULL
      ORDER BY t.id DESC LIMIT 1
    `, [platform])
    return rows[0]?.zernioAccountId || null
  }

  const { rows } = await pool.query(`
    SELECT access_token AS "accessToken"
    FROM tokens
    WHERE platform = $1 AND status != 'expired'
    ORDER BY id DESC
    LIMIT 1
  `, [platform])
  if (!rows[0]) return null
  return decrypt(rows[0].accessToken)
}

async function atualizarStatus(platform, ok, message) {
  const { rows } = await pool.query(`SELECT status, fail_count FROM platform_health WHERE platform = $1`, [platform])
  const atual = rows[0] || { status: 'unknown', fail_count: 0 }

  let novoStatus, novoFailCount
  if (ok) {
    novoStatus = 'up'
    novoFailCount = 0
  } else {
    novoFailCount = atual.fail_count + 1
    novoStatus = novoFailCount >= FAIL_THRESHOLD ? 'down' : atual.status
  }

  await pool.query(`
    INSERT INTO platform_health (platform, status, fail_count, message, checked_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (platform) DO UPDATE SET
      status = EXCLUDED.status, fail_count = EXCLUDED.fail_count,
      message = EXCLUDED.message, checked_at = NOW()
  `, [platform, novoStatus, novoFailCount, message || null])

  if (atual.status !== novoStatus) {
    await registrarLog({
      type: novoStatus === 'down' ? 'err' : 'ok',
      message: novoStatus === 'down'
        ? `${platform} parece estar fora do ar (${message || 'sem resposta'})`
        : `${platform} voltou a responder normalmente`,
      platform
    })
    broadcastEvent('platform_health_changed', { platform, status: novoStatus }, null)
  }
}

async function marcarApiOperacionalSemConta(platform) {
  await pool.query(`
    UPDATE platform_health
    SET status = 'up', fail_count = 0, message = NULL, checked_at = NOW()
    WHERE platform = $1 AND (status <> 'up' OR fail_count <> 0 OR message IS NOT NULL)
  `, [platform])
}

// Verifica a disponibilidade de cada plataforma que tenha ao menos uma conta
// conectada. Chamado a cada minuto pelo scheduler.
async function verificarSaudePlataformas() {
  for (const platform of PLATFORMS) {
    try {
      const token = await buscarTokenSonda(platform)
      if (!token) {
        await marcarApiOperacionalSemConta(platform)
        continue // sem conta conectada nessa plataforma, nada a verificar
      }

      const { ok, message } = await pingPlatform(platform, token)
      await atualizarStatus(platform, ok, message)
    } catch (err) {
      // Erro na própria checagem (ex: query no banco) não deve marcar a
      // plataforma como fora do ar — só loga.
      console.error(`[platformHealth] erro ao checar ${platform}:`, err.message)
    }
  }
}

async function getStatusMap() {
  const { rows } = await pool.query(`
    SELECT ph.platform, ph.status, ph.checked_at AS "checkedAt",
           EXISTS (SELECT 1 FROM contas c WHERE c.platform = ph.platform) AS "hasAccount"
    FROM platform_health ph
  `)
  const map = {}
  for (const p of PLATFORMS) map[p] = 'up'
  for (const r of rows) map[r.platform] = r.hasAccount ? r.status : 'up'
  return map
}

module.exports = { verificarSaudePlataformas, getStatusMap, PLATFORMS }
