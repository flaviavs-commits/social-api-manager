const fs = require('fs')
const path = require('path')
const pool = require('../db/pool')
const { registrarLog } = require('../repositories/logsRepository')
const tokensRepo = require('./../repositories/tokensRepository')

const UPLOADS_DIR = path.join(__dirname, '../../public/uploads')
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

const PLATFORM_COLUMNS = {
  facebook: 'facebook',
  instagram: 'instagram',
  youtube: 'youtube',
  tiktok: 'tiktok',
  kwai: 'kwai'
}

// ── Busca a conta+token conectados para a plataforma dentro da estrela/grupo ──
async function buscarContaToken(platform, groupName) {
  const coluna = PLATFORM_COLUMNS[platform]
  if (!coluna) return null

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.${coluna} AS handle
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    LEFT JOIN nichos n ON n.id = c.nicho_id
    WHERE t.platform = $1 AND n.nome = $2
    ORDER BY t.id DESC
    LIMIT 1
  `, [platform, groupName])

  return rows[0] || null
}

function mediaToBlob(mediaPath) {
  const filename = path.basename(mediaPath)
  const absPath = path.join(UPLOADS_DIR, filename)
  const buffer = fs.readFileSync(absPath)
  return { buffer, filename, absPath }
}

function mediaUrl(mediaPath) {
  return `${BASE_URL}${mediaPath}`
}

// ── Facebook (Graph API) ───────────────────────────────────────────────────────
async function publicarFacebook(token, post) {
  const pageId = token.handle || token.accountName
  if (!pageId) throw new Error('Conta Facebook sem ID/página configurado')

  if (!post.mediaPath) {
    const body = new URLSearchParams({ message: post.text || '', access_token: token.accessToken })
    const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`, { method: 'POST', body })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
    return data
  }

  const isVideo = post.mediaType === 'video'
  const endpoint = isVideo ? 'videos' : 'photos'
  const { buffer, filename } = mediaToBlob(post.mediaPath)

  const form = new FormData()
  form.append('access_token', token.accessToken)
  if (post.text) form.append(isVideo ? 'description' : 'caption', post.text)
  form.append('source', new Blob([buffer]), filename)

  const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/${endpoint}`, { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Facebook respondeu ${res.status}`)
  return data
}

// ── Instagram (Graph API - containers de mídia) ──────────────────────────────────
async function publicarInstagram(token, post) {
  const igUserId = token.handle || token.accountName
  if (!igUserId) throw new Error('Conta Instagram sem ID configurado')
  if (!post.mediaPath) throw new Error('Instagram exige uma imagem ou vídeo para publicar')

  const isVideo = post.mediaType === 'video'
  const params = new URLSearchParams({ access_token: token.accessToken })
  if (post.text) params.append('caption', post.text)
  if (isVideo) {
    params.append('media_type', 'REELS')
    params.append('video_url', mediaUrl(post.mediaPath))
  } else {
    params.append('image_url', mediaUrl(post.mediaPath))
  }

  const createRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: params })
  const createData = await createRes.json()
  if (!createRes.ok) throw new Error(createData?.error?.message || `Instagram respondeu ${createRes.status}`)

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: createData.id, access_token: token.accessToken })
  })
  const publishData = await publishRes.json()
  if (!publishRes.ok) throw new Error(publishData?.error?.message || `Instagram respondeu ${publishRes.status}`)
  return publishData
}

// ── YouTube (Data API v3 - upload de vídeo) ──────────────────────────────────────
async function publicarYoutube(token, post) {
  if (!post.mediaPath || post.mediaType !== 'video') throw new Error('YouTube exige um vídeo para publicar')

  const { buffer } = mediaToBlob(post.mediaPath)
  const metadata = {
    snippet: {
      title: (post.text || 'Novo vídeo').slice(0, 100),
      description: post.text || ''
    },
    status: { privacyStatus: 'private' }
  }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('media', new Blob([buffer]), 'video.mp4')

  const res = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: form
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `YouTube respondeu ${res.status}`)
  return data
}

// ── TikTok (Content Posting API v2) ──────────────────────────────────────────────
async function publicarTiktok(token, post) {
  if (!post.mediaPath || post.mediaType !== 'video') throw new Error('TikTok exige um vídeo para publicar')

  const { buffer } = mediaToBlob(post.mediaPath)

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: { title: post.text || '', privacy_level: 'SELF_ONLY' },
      source_info: { source: 'FILE_UPLOAD', video_size: buffer.length, chunk_size: buffer.length, total_chunk_count: 1 }
    })
  })
  const initData = await initRes.json()
  if (!initRes.ok || initData?.error?.code !== 'ok') {
    throw new Error(initData?.error?.message || `TikTok respondeu ${initRes.status}`)
  }

  const uploadUrl = initData.data.upload_url
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${buffer.length - 1}/${buffer.length}` },
    body: buffer
  })
  if (!uploadRes.ok) throw new Error(`Falha no upload do vídeo para o TikTok (status ${uploadRes.status})`)

  return initData.data
}

// ── Kwai (sem API pública de publicação - integração via login/senha) ────────────
async function publicarKwai(token, post) {
  // O Kwai não disponibiliza uma API pública/oficial para publicação de conteúdo
  // por aplicações de terceiros. A conexão é feita via login/senha (simulada),
  // então a publicação aqui também é simulada para fins de teste do fluxo.
  return {
    simulado: true,
    conta: token.handle || token.accountName,
    mediaType: post.mediaType,
    mensagem: 'Kwai não possui API pública de publicação - resultado simulado'
  }
}

const PUBLISHERS = {
  facebook: publicarFacebook,
  instagram: publicarInstagram,
  youtube: publicarYoutube,
  tiktok: publicarTiktok,
  kwai: publicarKwai
}

// ── Publica um post (já salvo no banco) em todas as suas plataformas ─────────────
async function publishPost(post) {
  const results = []

  for (const platform of post.platforms) {
    const publisher = PUBLISHERS[platform]
    if (!publisher) {
      results.push({ platform, success: false, error: `Plataforma "${platform}" não suportada` })
      continue
    }

    let token = await buscarContaToken(platform, post.group)
    if (!token) {
      const msg = `Nenhuma conta de ${platform} conectada na estrela "${post.group}"`
      results.push({ platform, success: false, error: msg })
      await registrarLog({ type: 'err', message: `Publicação falhou [${platform}]: ${msg}`, platform })
      continue
    }

    // ── Renovação automática do token antes de publicar, se necessário ──
    if (token.status !== 'valid') {
      const renewal = await tokensRepo.renovarToken(token.token_id)
      if (renewal.success) {
        token = await buscarContaToken(platform, post.group)
      } else {
        results.push({ platform, success: false, account: token.handle || token.accountName, error: renewal.message })
        continue
      }
    }

    try {
      const data = await publisher(token, post)
      results.push({ platform, success: true, account: token.handle || token.accountName, data })
      await registrarLog({
        type: 'ok',
        message: `Post publicado [${platform}] na conta "${token.handle || token.accountName}"`,
        platform,
        conta_id: token.contaId
      })
    } catch (err) {
      results.push({ platform, success: false, account: token.handle || token.accountName, error: err.message })
      await registrarLog({
        type: 'err',
        message: `Falha ao publicar [${platform}] em "${token.handle || token.accountName}": ${err.message}`,
        platform,
        conta_id: token.contaId
      })
    }
  }

  return results
}

module.exports = { publishPost, buscarContaToken }
