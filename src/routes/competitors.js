const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, PLATFORMS, serverError } = require('../utils/http')
const { coletarBenchmarksSelecionados } = require('../services/benchmarkObserver')

const router = Router()

const PLATFORM_HOSTS = {
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']
}

const SNAPSHOT_FIELDS = [
  ['followers', 'Seguidores', true],
  ['postsLast30Days', 'publicações nos últimos 30 dias', true],
  ['avgLikes', 'média de curtidas', false],
  ['avgComments', 'média de comentários', false],
  ['avgShares', 'média de compartilhamentos', false],
  ['avgViews', 'média de visualizações', false],
  ['avgSaves', 'média de salvamentos', false]
]

function cleanHandle(value) {
  return String(value || '').trim().replace(/^@+/, '').slice(0, 120)
}

function normalizeNiche(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR').slice(0, 80)
}

function validPublicUrl(value, platform) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && PLATFORM_HOSTS[platform]?.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function parseMetric(value, label, integer = false) {
  if (value === undefined || value === null || value === '') return 0
  const parsed = Number(value)
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000_000_000 && (!integer || Number.isInteger(parsed))
  if (!valid) {
    const error = new Error(`${label} inválido.`)
    error.statusCode = 400
    throw error
  }
  return parsed
}

function parseDate(value) {
  const date = value || new Date().toISOString().slice(0, 10)
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    const error = new Error('Data da coleta inválida.')
    error.statusCode = 400
    throw error
  }
  return date
}

function publicProfileError(res, message) {
  return res.status(400).json({ erro: message })
}

function engagementRate(snapshot) {
  const followers = Number(snapshot?.followers || 0)
  if (!followers) return 0
  const interactions = ['avgLikes', 'avgComments', 'avgShares', 'avgSaves']
    .reduce((sum, key) => sum + Number(snapshot?.[key] || 0), 0)
  return (interactions / followers) * 100
}

function normalizeSnapshot(row) {
  if (!row) return null
  const snapshot = {
    id: row.snapshot_id,
    capturedOn: row.captured_on,
    followers: Number(row.followers || 0),
    postsLast30Days: Number(row.posts_last_30_days || 0),
    avgLikes: Number(row.avg_likes || 0),
    avgComments: Number(row.avg_comments || 0),
    avgShares: Number(row.avg_shares || 0),
    avgViews: Number(row.avg_views || 0),
    avgSaves: Number(row.avg_saves || 0),
    sourceUrl: row.source_url || null,
    collectionMethod: row.collection_method || 'manual'
  }
  return { ...snapshot, engagementRate: engagementRate(snapshot) }
}

const profileSelect = `
  SELECT cp.id,
         cp.name,
         cp.platform,
         cp.handle,
         cp.profile_url AS "profileUrl",
         cp.niche,
         cp.active,
         cp.public_only AS "publicOnly",
         cp.monitor_enabled AS "monitorEnabled",
         cp.monitor_provider AS "monitorProvider",
         cp.monitor_interval_minutes AS "monitorIntervalMinutes",
         cp.last_synced_at AS "lastSyncedAt",
         cp.monitor_status AS "monitorStatus",
         cp.monitor_error AS "monitorError",
         cp.criado_em AS "createdAt",
         s.id AS snapshot_id,
         s.captured_on,
         s.followers,
         s.posts_last_30_days,
         s.avg_likes,
         s.avg_comments,
         s.avg_shares,
         s.avg_views,
         s.avg_saves,
         s.source_url,
         s.collection_method
    FROM competitor_profiles cp
    LEFT JOIN LATERAL (
      SELECT *
        FROM public_profile_snapshots
       WHERE competitor_profile_id = cp.id
       ORDER BY captured_on DESC, id DESC
       LIMIT 1
    ) s ON TRUE
   WHERE cp.user_id = $1
`

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`${profileSelect} ORDER BY cp.niche ASC, cp.name ASC`, [req.user.id])
    const competitors = rows.map(row => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      handle: row.handle,
      profileUrl: row.profileUrl,
      niche: row.niche || 'geral',
      active: row.active,
      publicOnly: row.publicOnly !== false,
      createdAt: row.createdAt,
      monitor: {
        enabled: row.monitorEnabled === true,
        provider: row.monitorProvider || 'auto',
        intervalMinutes: Number(row.monitorIntervalMinutes || 15),
        lastSyncedAt: row.lastSyncedAt || null,
        status: row.monitorStatus || 'idle',
        error: row.monitorError || null
      },
      latestSnapshot: normalizeSnapshot(row)
    }))
    const niches = [...new Set(competitors.map(item => item.niche))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    const withSnapshots = competitors.filter(item => item.latestSnapshot)
    const totalFollowers = withSnapshots.reduce((sum, item) => sum + item.latestSnapshot.followers, 0)
    const averageEngagementRate = withSnapshots.length
      ? withSnapshots.reduce((sum, item) => sum + item.latestSnapshot.engagementRate, 0) / withSnapshots.length
      : 0
    const topProfile = [...withSnapshots].sort((a, b) => b.latestSnapshot.engagementRate - a.latestSnapshot.engagementRate)[0] || null
    res.json({
      competitors,
      summary: {
        profiles: competitors.length,
        niches: niches.length,
        snapshots: withSnapshots.length,
        totalFollowers,
        averageEngagementRate,
        topProfileId: topProfile?.id || null,
        niches
      }
    })
  } catch (err) {
    serverError(res, err)
  }
})

router.post('/', async (req, res) => {
  try {
    const { name, platform, handle, profileUrl, niche, publicProfile = true } = req.body || {}
    const cleanName = String(name || '').trim().slice(0, 160)
    const cleanNiche = normalizeNiche(niche)
    const cleanProfileUrl = String(profileUrl || '').trim()
    const cleanProfileHandle = cleanHandle(handle)
    if (!cleanName || !cleanProfileHandle || !cleanNiche || !PLATFORMS.includes(platform)) {
      return publicProfileError(res, 'Nome, rede, nicho e identificador são obrigatórios.')
    }
    if (publicProfile !== true) return publicProfileError(res, 'Só é permitido acompanhar perfis declarados como públicos.')
    if (!validPublicUrl(cleanProfileUrl, platform)) {
      return publicProfileError(res, 'Informe uma URL HTTPS pública da própria rede social selecionada.')
    }
    const { rows } = await pool.query(`
      INSERT INTO competitor_profiles (user_id, name, platform, handle, profile_url, niche, public_only)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING id
    `, [req.user.id, cleanName, platform, cleanProfileHandle, cleanProfileUrl, cleanNiche])
    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    if (err.statusCode === 400) return publicProfileError(res, err.message)
    serverError(res, err)
  }
})

router.post('/collect', async (req, res) => {
  try {
    const requestedIds = Array.isArray(req.body?.profileIds) ? req.body.profileIds : []
    const profileIds = [...new Set(requestedIds.map(parseId).filter(Boolean))]
    if (!profileIds.length) return publicProfileError(res, 'Selecione pelo menos um perfil público para coletar.')
    if (profileIds.length > 50) return publicProfileError(res, 'A coleta em lote aceita no máximo 50 perfis por vez.')
    const result = await coletarBenchmarksSelecionados(req.user.id, profileIds)
    res.json(result)
  } catch (err) {
    if (err.statusCode === 400) return publicProfileError(res, err.message)
    serverError(res, err)
  }
})

router.patch('/:id/monitor', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const profile = await pool.query('SELECT platform FROM competitor_profiles WHERE id=$1 AND user_id=$2', [id, req.user.id])
    if (!profile.rowCount) return res.status(404).json({ erro: 'Perfil não encontrado.' })
    const enabled = req.body?.enabled === true
    const provider = ['auto', 'youtube_public', 'zernio'].includes(req.body?.provider) ? req.body.provider : 'auto'
    const intervalMinutes = [5, 15, 30, 60].includes(Number(req.body?.intervalMinutes)) ? Number(req.body.intervalMinutes) : 15
    if (provider === 'youtube_public' && profile.rows[0].platform !== 'youtube') {
      return publicProfileError(res, 'O monitor público automático está disponível para YouTube.')
    }
    await pool.query(`
      UPDATE competitor_profiles
         SET monitor_enabled=$1,
             monitor_provider=$2,
             monitor_interval_minutes=$3,
             monitor_status=$4,
             monitor_error=NULL
       WHERE id=$5 AND user_id=$6
    `, [enabled, provider, intervalMinutes, enabled ? 'idle' : 'idle', id, req.user.id])
    res.json({ enabled, provider, intervalMinutes, status: 'idle', error: null })
  } catch (err) {
    serverError(res, err)
  }
})

router.get('/:id/snapshots', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const { rows } = await pool.query(`
      SELECT s.id, s.captured_on AS "capturedOn", s.followers,
             s.posts_last_30_days AS "postsLast30Days", s.avg_likes AS "avgLikes",
             s.avg_comments AS "avgComments", s.avg_shares AS "avgShares",
             s.avg_views AS "avgViews", s.avg_saves AS "avgSaves",
             s.source_url AS "sourceUrl", s.collection_method AS "collectionMethod"
        FROM public_profile_snapshots s
        JOIN competitor_profiles cp ON cp.id = s.competitor_profile_id
       WHERE s.competitor_profile_id = $1 AND cp.user_id = $2
       ORDER BY s.captured_on DESC, s.id DESC
       LIMIT 60
    `, [id, req.user.id])
    res.json({ snapshots: rows.map(row => ({ ...row, engagementRate: engagementRate(row) })) })
  } catch (err) {
    serverError(res, err)
  }
})

router.post('/:id/snapshots', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const profile = await pool.query('SELECT id, platform FROM competitor_profiles WHERE id=$1 AND user_id=$2 AND public_only=TRUE', [id, req.user.id])
    if (!profile.rowCount) return res.status(404).json({ erro: 'Perfil público não encontrado.' })
    const body = req.body || {}
    const capturedOn = parseDate(body.capturedOn)
    const metrics = Object.fromEntries(SNAPSHOT_FIELDS.map(([key, label, integer]) => [key, parseMetric(body[key], label, integer)]))
    const sourceUrl = String(body.sourceUrl || '').trim().slice(0, 500) || null
    const collectionMethod = body.collectionMethod === 'official_api' ? 'official_api' : 'manual'
    if (sourceUrl && !validPublicUrl(sourceUrl, profile.rows[0].platform)) {
      return publicProfileError(res, 'A fonte precisa ser uma URL HTTPS pública da mesma rede social.')
    }
    const { rows } = await pool.query(`
      INSERT INTO public_profile_snapshots (
        competitor_profile_id, captured_on, followers, posts_last_30_days,
        avg_likes, avg_comments, avg_shares, avg_views, avg_saves,
        source_url, collection_method
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (competitor_profile_id, captured_on) DO UPDATE SET
        followers=EXCLUDED.followers,
        posts_last_30_days=EXCLUDED.posts_last_30_days,
        avg_likes=EXCLUDED.avg_likes,
        avg_comments=EXCLUDED.avg_comments,
        avg_shares=EXCLUDED.avg_shares,
        avg_views=EXCLUDED.avg_views,
        avg_saves=EXCLUDED.avg_saves,
        source_url=EXCLUDED.source_url,
        collection_method=EXCLUDED.collection_method
      RETURNING id, captured_on AS "capturedOn", followers,
                posts_last_30_days AS "postsLast30Days", avg_likes AS "avgLikes",
                avg_comments AS "avgComments", avg_shares AS "avgShares",
                avg_views AS "avgViews", avg_saves AS "avgSaves",
                source_url AS "sourceUrl", collection_method AS "collectionMethod"
    `, [id, capturedOn, metrics.followers, metrics.postsLast30Days, metrics.avgLikes, metrics.avgComments, metrics.avgShares, metrics.avgViews, metrics.avgSaves, sourceUrl, collectionMethod])
    res.status(201).json({ snapshot: { ...rows[0], engagementRate: engagementRate(rows[0]) } })
  } catch (err) {
    if (err.statusCode === 400) return publicProfileError(res, err.message)
    serverError(res, err)
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    await pool.query('DELETE FROM competitor_profiles WHERE id=$1 AND user_id=$2', [id, req.user.id])
    res.status(204).send()
  } catch (err) {
    serverError(res, err)
  }
})

module.exports = router
