const pool = require('../db/pool')

async function criarPost({ text, platforms, group_name, scheduledAt, repeat = 'none', mediaPath = null, mediaType = null, mediaItems = null, youtubeTitle = null, youtubeVisibility = 'public', youtubeIsShort = null, userId }) {
  const { rows } = await pool.query(`
    INSERT INTO posts (text, platforms, group_name, scheduled_at, repeat, media_path, media_type, media_items, youtube_title, youtube_visibility, youtube_is_short, user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [text, platforms, group_name, scheduledAt, repeat, mediaPath, mediaType, mediaItems ? JSON.stringify(mediaItems) : null, youtubeTitle, youtubeVisibility, youtubeIsShort, userId])
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
      id, text, platforms, group_name AS "group",
      scheduled_at AS "scheduledAt", repeat, status, criado_em, user_id AS "userId",
      media_path AS "mediaPath", media_type AS "mediaType", media_items AS "mediaItems",
      youtube_title AS "youtubeTitle", youtube_visibility AS "youtubeVisibility", youtube_is_short AS "youtubeIsShort"
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
      id, text, platforms, group_name AS "group",
      scheduled_at AS "scheduledAt", repeat, status, criado_em, user_id AS "userId",
      media_path AS "mediaPath", media_type AS "mediaType", media_items AS "mediaItems",
      youtube_title AS "youtubeTitle", youtube_visibility AS "youtubeVisibility", youtube_is_short AS "youtubeIsShort"
    FROM posts
    WHERE id = $1
  `, [id])
  const post = rows[0] || null
  if (!post) return null
  if (!isAdmin && post.userId !== userId) return null
  return post
}

async function atualizarStatusPost(id, status) {
  await pool.query(`UPDATE posts SET status = $1 WHERE id = $2`, [status, id])
}

module.exports = { criarPost, listarPosts, deletarPost, buscarPostPorId, atualizarStatusPost }