const pool = require('../db/pool')

async function criarPost({ text, platforms, group_name, scheduledAt, repeat = 'none', mediaPath = null, mediaType = null }) {
  const { rows } = await pool.query(`
    INSERT INTO posts (text, platforms, group_name, scheduled_at, repeat, media_path, media_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [text, platforms, group_name, scheduledAt, repeat, mediaPath, mediaType])
  return rows[0]
}

async function listarPosts({ status } = {}) {
  const where = status ? `WHERE status = $1` : ''
  const params = status ? [status] : []
  const { rows } = await pool.query(`
    SELECT
      id, text, platforms, group_name AS "group",
      scheduled_at AS "scheduledAt", repeat, status, criado_em,
      media_path AS "mediaPath", media_type AS "mediaType"
    FROM posts
    ${where}
    ORDER BY scheduled_at ASC
  `, params)
  return rows
}

async function deletarPost(id) {
  const { rowCount } = await pool.query(
    `UPDATE posts SET status='cancelled' WHERE id=$1 AND status='scheduled'`, [id]
  )
  return rowCount > 0
}

async function buscarPostPorId(id) {
  const { rows } = await pool.query(`
    SELECT
      id, text, platforms, group_name AS "group",
      scheduled_at AS "scheduledAt", repeat, status, criado_em,
      media_path AS "mediaPath", media_type AS "mediaType"
    FROM posts
    WHERE id = $1
  `, [id])
  return rows[0] || null
}

async function atualizarStatusPost(id, status) {
  await pool.query(`UPDATE posts SET status = $1 WHERE id = $2`, [status, id])
}

module.exports = { criarPost, listarPosts, deletarPost, buscarPostPorId, atualizarStatusPost }