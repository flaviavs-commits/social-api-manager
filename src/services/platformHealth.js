const pool = require('../db/pool')
const { decrypt } = require('./tokenCrypto')
const { registrarLog, broadcastEvent } = require('../repositories/logsRepository')

// Quantas falhas seguidas até considerar a plataforma "fora do ar". Evita
// marcar como down por causa de uma falha isolada de rede (flakiness).
const FAIL_THRESHOLD = 2

const PLATFORMS = ['instagram', 'facebook', 'youtube', 'tiktok']

// Chamada leve (não conta como publicação) só para verificar se a API da
// plataforma está respondendo, usando o token de uma conta conectada
// qualquer como sonda.
async function pingPlatform(platform, accessToken) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    let url
    if (platform === 'facebook') {
      url = `https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(accessToken)}`
    } else if (platform === 'instagram') {
      url = `https://graph.instagram.com/me?fields=id&access_token=${encodeURIComponent(accessToken)}`
    } else if (platform === 'youtube') {
      url = `https://www.googleapis.com/youtube/v3/channels?part=id&mine=true`
    } else if (platform === 'tiktok') {
      url = `https://open.tiktokapis.com/v2/user/info/?fields=open_id`
    } else {
      return { ok: false, message: 'plataforma desconhecida' }
    }

    const headers = (platform === 'youtube' || platform === 'tiktok')
      ? { Authorization: `Bearer ${accessToken}` }
      : {}

    const res = await fetch(url, { headers, signal: controller.signal })

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

// Verifica a disponibilidade de cada plataforma que tenha ao menos uma conta
// conectada. Chamado a cada minuto pelo scheduler.
async function verificarSaudePlataformas() {
  for (const platform of PLATFORMS) {
    try {
      const token = await buscarTokenSonda(platform)
      if (!token) continue // sem conta conectada nessa plataforma, nada a verificar

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
  const { rows } = await pool.query(`SELECT platform, status, checked_at AS "checkedAt" FROM platform_health`)
  const map = {}
  for (const p of PLATFORMS) map[p] = 'unknown'
  for (const r of rows) map[r.platform] = r.status
  return map
}

module.exports = { verificarSaudePlataformas, getStatusMap, PLATFORMS }
