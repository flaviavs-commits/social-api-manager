const pool = require('../db/pool')

async function criarPost({ text, platforms, scheduledAt, repeat = 'none', mediaPath = null, mediaType = null, mediaItems = null, youtubeTitle = null, youtubeVisibility = 'public', youtubeIsShort = null, accountId = null, userId, status = 'scheduled' }) {
  const { rows } = await pool.query(`
    INSERT INTO posts (text, platforms, scheduled_at, repeat, media_path, media_type, media_items, youtube_title, youtube_visibility, youtube_is_short, account_id, user_id, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [text, platforms, scheduledAt, repeat, mediaPath, mediaType, mediaItems ? JSON.stringify(mediaItems) : null, youtubeTitle, youtubeVisibility, youtubeIsShort, accountId, userId, status])
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
      p.external_post_id AS "externalPostId", p.external_platform AS "externalPlatform", p.published_at AS "publishedAt",
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

// Marca atomicamente os posts agendados como "processing" antes de publicar,
// para que dois ciclos do cron sobrepostos (ex: publicação lenta do Instagram)
// nunca peguem e publiquem o mesmo post duas vezes.
async function reservarPostsPendentes() {
  const { rows } = await pool.query(`
    WITH reservados AS (
      UPDATE posts SET status = 'processing'
      WHERE id IN (
        SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at <= NOW()
      )
      RETURNING
        id, text, platforms, scheduled_at, repeat, status, user_id,
        media_path, media_type, media_items,
        youtube_title, youtube_visibility, youtube_is_short, account_id
    )
    SELECT
      r.id, r.text, r.platforms,
      r.scheduled_at AS "scheduledAt", r.repeat, r.status, r.user_id AS "userId",
      r.media_path AS "mediaPath", r.media_type AS "mediaType", r.media_items AS "mediaItems",
      r.youtube_title AS "youtubeTitle", r.youtube_visibility AS "youtubeVisibility", r.youtube_is_short AS "youtubeIsShort",
      r.account_id AS "accountId",
      u.role AS "userRole"
    FROM reservados r
    LEFT JOIN users u ON u.id = r.user_id
  `)
  return rows
}

// Guarda o ID do post/mídia retornado pela rede social ao publicar, para
// permitir buscar métricas (likes/comentários) depois. Posts publicados
// antes desta coluna existir, ou em redes sem ID público utilizável
// (TikTok), ficam com esses campos nulos.
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
    LIMIT 50
  `, params)
  return rows
}

// Preenche o account_id de um post antigo (criado antes dessa coluna existir
// ou sem conta escolhida explicitamente), descoberto durante a reconciliação.
async function definirAccountIdSeVazio(id, accountId) {
  await pool.query(`UPDATE posts SET account_id = $1 WHERE id = $2 AND account_id IS NULL`, [accountId, id])
}

// Guarda os containers do Instagram ainda em processamento (status_code
// IN_PROGRESS) — a publicação real (media_publish) só acontece num próximo
// tick do cron, quando finalizarInstagramPendentes() confirmar FINISHED.
async function salvarInstagramPending(id, pendingState) {
  await pool.query(`UPDATE posts SET instagram_pending = $1 WHERE id = $2`, [JSON.stringify(pendingState), id])
}

async function limparInstagramPending(id) {
  await pool.query(`UPDATE posts SET instagram_pending = NULL WHERE id = $1`, [id])
}

// Posts com containers do Instagram aguardando confirmação de processamento —
// candidatos a serem finalizados (media_publish) no próximo tick do cron.
async function listarPostsComInstagramPendente() {
  const { rows } = await pool.query(`
    SELECT id, text, platforms, status, user_id AS "userId", account_id AS "accountId", instagram_pending AS "instagramPending"
    FROM posts
    WHERE instagram_pending IS NOT NULL
  `)
  return rows
}

// Salva um snapshot diário das métricas de um post (1 ponto por dia), para
// alimentar o gráfico de curtidas ao longo do tempo — a API da rede social
// só dá o valor atual, então é o Analytics que constrói o histórico, dia a
// dia, a cada vez que busca métricas reais.
async function registrarSnapshotMetricas(postId, { likes, comments, views }) {
  await pool.query(`
    INSERT INTO post_metrics_history (post_id, captured_on, likes, comments, views)
    VALUES ($1, CURRENT_DATE, $2, $3, $4)
    ON CONFLICT (post_id, captured_on) DO UPDATE SET likes = $2, comments = $3, views = $4
  `, [postId, likes ?? null, comments ?? null, views ?? null])
}

// Histórico diário de curtidas/comentários/views de um post, para o gráfico
// de linha no Analytics.
async function buscarHistoricoMetricas(postId) {
  const { rows } = await pool.query(`
    SELECT captured_on AS "date", likes, comments, views
    FROM post_metrics_history
    WHERE post_id = $1
    ORDER BY captured_on ASC
  `, [postId])
  return rows
}

// Retorna todos os posts de um mês/ano específico (agendados, publicados, erro, etc.)
// para alimentar o calendário. Exclui apenas cancelados.
async function listarPostsCalendario({ year, month, userId, isAdmin }) {
  // month é 1-based (1=janeiro, 12=dezembro)
  const inicio = new Date(Date.UTC(year, month - 1, 1))
  const fim    = new Date(Date.UTC(year, month, 1))

  const conds  = [`scheduled_at >= $1`, `scheduled_at < $2`, `status <> 'cancelled'`]
  const params = [inicio.toISOString(), fim.toISOString()]

  if (!isAdmin) {
    params.push(userId)
    conds.push(`user_id = $${params.length}`)
  }

  const { rows } = await pool.query(`
    SELECT
      id, text, platforms, status, repeat,
      scheduled_at  AS "scheduledAt",
      published_at  AS "publishedAt",
      media_path    AS "mediaPath",
      media_type    AS "mediaType",
      media_items   AS "mediaItems",
      youtube_title AS "youtubeTitle",
      account_id    AS "accountId",
      user_id       AS "userId"
    FROM posts
    WHERE ${conds.join(' AND ')}
    ORDER BY scheduled_at ASC
  `, params)
  return rows
}

async function reagendarPost({ id, scheduledAt, userId, isAdmin }) {
  const { rows } = await pool.query(
    `UPDATE posts SET scheduled_at = $1
     WHERE id = $2 AND status = 'scheduled' ${isAdmin ? '' : 'AND user_id = $3'}
     RETURNING id`,
    isAdmin ? [scheduledAt, id] : [scheduledAt, id, userId]
  )
  return rows[0] || null
}

module.exports = {
  criarPost, listarPosts, deletarPost, buscarPostPorId, atualizarStatusPost,
  reservarPostsPendentes,
  salvarPublicacaoExterna, listarPostsPublicadosSemExternalId, definirAccountIdSeVazio,
  salvarInstagramPending, limparInstagramPending, listarPostsComInstagramPendente,
  registrarSnapshotMetricas, buscarHistoricoMetricas,
  listarPostsCalendario, reagendarPost
}
