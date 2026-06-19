const pool = require('../db/pool')

async function criarPost({ text, platforms, scheduledAt, repeat = 'none', mediaPath = null, mediaType = null, mediaItems = null, youtubeTitle = null, youtubeVisibility = 'public', youtubeIsShort = null, accountId = null, userId }) {
  const { rows } = await pool.query(`
    INSERT INTO posts (text, platforms, scheduled_at, repeat, media_path, media_type, media_items, youtube_title, youtube_visibility, youtube_is_short, account_id, user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [text, platforms, scheduledAt, repeat, mediaPath, mediaType, mediaItems ? JSON.stringify(mediaItems) : null, youtubeTitle, youtubeVisibility, youtubeIsShort, accountId, userId])
  return rows[0]
}

async function listarPosts({ status, userId, isAdmin } = {}) {
  const conds = []
  const params = []
  if (status) { params.push(status); conds.push(`status = $${params.length}`) }
  if (!isAdmin) { params.push(userId); conds.push(`user_id = $${params.length}`) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT
      id, text, platforms,
      scheduled_at AS "scheduledAt", repeat, status, criado_em, user_id AS "userId",
      media_path AS "mediaPath", media_type AS "mediaType", media_items AS "mediaItems",
      youtube_title AS "youtubeTitle", youtube_visibility AS "youtubeVisibility", youtube_is_short AS "youtubeIsShort",
      account_id AS "accountId",
      external_post_id AS "externalPostId", external_platform AS "externalPlatform", published_at AS "publishedAt"
    FROM posts
    ${where}
    ORDER BY scheduled_at ASC
  `, params)
  return rows
}

async function deletarPost(id, userId, isAdmin) {
  const post = await buscarPostPorId(id, userId, isAdmin)
  if (!post) return false
  const { rowCount } = await pool.query(
    `UPDATE posts SET status='cancelled' WHERE id=$1 AND status='scheduled'`, [id]
  )
  return rowCount > 0
}

async function buscarPostPorId(id, userId, isAdmin) {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.text, p.platforms,
      p.scheduled_at AS "scheduledAt", p.repeat, p.status, p.criado_em, p.user_id AS "userId",
      p.media_path AS "mediaPath", p.media_type AS "mediaType", p.media_items AS "mediaItems",
      p.youtube_title AS "youtubeTitle", p.youtube_visibility AS "youtubeVisibility", p.youtube_is_short AS "youtubeIsShort",
      p.account_id AS "accountId",
      u.role AS "userRole"
    FROM posts p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.id = $1
  `, [id])
  const post = rows[0] || null
  if (!post) return null
  if (!isAdmin && post.userId !== userId) return null
  return post
}

async function atualizarStatusPost(id, status) {
  await pool.query(`UPDATE posts SET status = $1 WHERE id = $2`, [status, id])
}

// Guarda o ID do post/mídia retornado pela rede social ao publicar, para
// permitir buscar métricas (likes/comentários) depois. Posts publicados
// antes desta coluna existir, ou em redes sem ID público utilizável
// (TikTok, Kwai), ficam com esses campos nulos.
async function salvarPublicacaoExterna(id, { externalPostId, externalPlatform, publishedAt }) {
  await pool.query(
    `UPDATE posts SET external_post_id = $1, external_platform = $2, published_at = $3 WHERE id = $4`,
    [externalPostId, externalPlatform, publishedAt, id]
  )
}

// Posts publicados numa plataforma que ainda não têm o ID externo salvo —
// candidatos para reconciliação retroativa (buscar o post real na rede
// social e casar pela data/texto/mídia).
async function listarPostsPublicadosSemExternalId(platform, userId, isAdmin) {
  const conds = [`status = 'published'`, `platforms @> ARRAY[$1]::text[]`, `external_post_id IS NULL`]
  const params = [platform]
  if (!isAdmin) { params.push(userId); conds.push(`user_id = $${params.length}`) }

  const { rows } = await pool.query(`
    SELECT id, text, platforms, scheduled_at AS "scheduledAt", criado_em, account_id AS "accountId",
           media_path AS "mediaPath", media_type AS "mediaType", media_items AS "mediaItems"
    FROM posts
    WHERE ${conds.join(' AND ')}
    ORDER BY scheduled_at DESC
  `, params)
  return rows
}

// Preenche o account_id de um post antigo (criado antes dessa coluna existir
// ou sem conta escolhida explicitamente), descoberto durante a reconciliação.
async function definirAccountIdSeVazio(id, accountId) {
  await pool.query(`UPDATE posts SET account_id = $1 WHERE id = $2 AND account_id IS NULL`, [accountId, id])
}

module.exports = {
  criarPost, listarPosts, deletarPost, buscarPostPorId, atualizarStatusPost,
  salvarPublicacaoExterna, listarPostsPublicadosSemExternalId, definirAccountIdSeVazio
}
