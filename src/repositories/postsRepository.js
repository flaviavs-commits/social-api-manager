const pool = require('../db/pool')

async function criarPost({ text, platforms, group_name, scheduledAt, repeat = 'none' }) {
  const { rows } = await pool.query(`
    INSERT INTO posts (text, platforms, group_name, scheduled_at, repeat)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [text, platforms, group_name, scheduledAt, repeat])
  return rows[0]
}

async function listarPosts({ status } = {}) {
  const where = status ? `WHERE status = $1` : ''
  const params = status ? [status] : []
  const { rows } = await pool.query(`
    SELECT
      id, text, platforms, group_name AS "group",
      scheduled_at AS "scheduledAt", repeat, status, criado_em
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

module.exports = { criarPost, listarPosts, deletarPost }