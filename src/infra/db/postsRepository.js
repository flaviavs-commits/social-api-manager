const pool = require('../../db/pool')

async function criarPost({ text, platforms, scheduledAt, repeat = 'none', mediaPath = null, mediaType = null, mediaItems = null, youtubeTitle = null, youtubeVisibility = 'public', youtubeIsShort = null, accountId = null, userId, status = 'scheduled' }) {
  const { rows } = await pool.query(`
    INSERT INTO posts (text, platforms, scheduled_at, repeat, media_path, media_type, media_items, youtube_title, youtube_visibility, youtube_is_short, account_id, user_id, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [text, platforms, scheduledAt, repeat, mediaPath, mediaType, mediaItems ? JSON.stringify(mediaItems) : null, youtubeTitle, youtubeVisibility, youtubeIsShort, accountId, userId, status])
  return rows[0]
}

// Associa as contas resolvidas (uma por conta conectada de cada rede
// marcada) a um post recém-criado — ver domain/posts, criarPost.js e
// migrations/027_post_accounts.sql. Um post pode ter N contas, inclusive
// várias da mesma rede (ex.: 2 perfis de Instagram publicando juntos).
async function definirContasDoPost(postId, accountIds) {
  if (!accountIds.length) return
  const values = accountIds.map((_, i) => `($1, $${i + 2})`).join(', ')
  await pool.query(
    `INSERT INTO post_accounts (post_id, account_id) VALUES ${values} ON CONFLICT (post_id, account_id) DO NOTHING`,
    [postId, ...accountIds]
  )
}

// Contas associadas a um post, com a plataforma da conta — usado para
// reidratar post.accounts em reservarPostsPendentes/buscarPostPorId, já que
// publishPost() agora itera por (conta, rede) em vez de só por rede.
async function listarContasDoPost(postId) {
  const { rows } = await pool.query(`
    SELECT pa.id AS "postAccountId", pa.account_id AS "accountId", c.platform, c.handle
    FROM post_accounts pa
    JOIN contas c ON c.id = pa.account_id
    WHERE pa.post_id = $1
  `, [postId])
  return rows
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
      u.role AS "userRole",
      COALESCE(
        JSON_AGG(JSON_BUILD_OBJECT('postAccountId', pa.id, 'accountId', pa.account_id, 'platform', c.platform, 'handle', c.handle))
          FILTER (WHERE pa.id IS NOT NULL),
        '[]'
      ) AS accounts
    FROM posts p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN post_accounts pa ON pa.post_id = p.id
    LEFT JOIN contas c ON c.id = pa.account_id
    WHERE p.id = $1
    GROUP BY p.id, u.role
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
        SELECT p.id FROM posts p
        WHERE p.status = 'scheduled' AND p.scheduled_at <= NOW()
        -- Segura o post se TODAS as suas plataformas estiverem fora do ar;
        -- volta a tentar no próximo tick do cron (1 min depois) até
        -- alguma plataforma voltar a responder ('up' ou 'unknown').
        AND EXISTS (
          SELECT 1 FROM unnest(p.platforms) AS plat
          WHERE plat NOT IN (SELECT platform FROM platform_health WHERE status = 'down')
        )
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
      u.role AS "userRole",
      COALESCE(
        JSON_AGG(JSON_BUILD_OBJECT('postAccountId', pa.id, 'accountId', pa.account_id, 'platform', c.platform, 'handle', c.handle))
          FILTER (WHERE pa.id IS NOT NULL),
        '[]'
      ) AS accounts
    FROM reservados r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN post_accounts pa ON pa.post_id = r.id
    LEFT JOIN contas c ON c.id = pa.account_id
    GROUP BY r.id, r.text, r.platforms, r.scheduled_at, r.repeat, r.status, r.user_id,
             r.media_path, r.media_type, r.media_items, r.youtube_title, r.youtube_visibility,
             r.youtube_is_short, r.account_id, u.role
  `)
  return rows
}

// Guarda o ID do post/mídia retornado pela rede social ao publicar, para
// permitir buscar métricas (likes/comentários) depois. Posts publicados
// antes desta coluna existir, ou em redes sem ID público utilizável
// (TikTok), ficam com esses campos nulos.
//
// Um post pode ir para várias redes: grava uma linha por rede em
// post_publications (upsert), preservando o ID externo de cada uma para o
// Analytics. As colunas legadas external_post_id/external_platform em posts
// guardam só a PRIMEIRA rede publicada (usadas por comentários/inbox, que só
// precisam de algum ID do post) — não sobrescreve se já houver uma, para não
// perder qual foi a primeira quando publicando em paralelo.
async function salvarPublicacaoExterna(id, { externalPostId, externalPlatform, publishedAt, accountId = null }) {
  // accountId sempre vem preenchido no fluxo atual (publisher.js resolve a
  // conta antes de chamar isto) — o índice único parcial em post_publications
  // só cobre account_id IS NOT NULL, então esse é o caminho de conflito real.
  // O ramo sem accountId existe só por segurança (nunca deveria ser
  // exercitado), e não tenta ON CONFLICT (não há índice único para colidir).
  if (accountId) {
    await pool.query(
      `INSERT INTO post_publications (post_id, platform, external_post_id, published_at, account_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id, platform, account_id) WHERE account_id IS NOT NULL
         DO UPDATE SET external_post_id = EXCLUDED.external_post_id, published_at = EXCLUDED.published_at`,
      [id, externalPlatform, externalPostId, publishedAt, accountId]
    )
  } else {
    await pool.query(
      `INSERT INTO post_publications (post_id, platform, external_post_id, published_at)
       VALUES ($1, $2, $3, $4)`,
      [id, externalPlatform, externalPostId, publishedAt]
    )
  }
  await pool.query(
    `UPDATE posts
     SET external_post_id = $1, external_platform = $2, published_at = COALESCE(published_at, $3)
     WHERE id = $4 AND external_post_id IS NULL`,
    [externalPostId, externalPlatform, publishedAt, id]
  )
}

// Todas as publicações (uma por rede) dos posts informados, para o Analytics
// montar uma entrada de métricas por (post, rede) em vez de só uma por post.
async function listarPublicacoesDosPosts(postIds) {
  if (!postIds.length) return []
  const { rows } = await pool.query(
    `SELECT post_id AS "postId", platform, account_id AS "accountId", external_post_id AS "externalPostId", published_at AS "publishedAt"
     FROM post_publications
     WHERE post_id = ANY($1) AND external_post_id IS NOT NULL`,
    [postIds]
  )
  return rows
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
// A pendência é por (post, conta) — post_accounts.id (não posts.id) — para
// suportar múltiplas contas de Instagram publicando o mesmo post em paralelo,
// cada uma com sua própria pendência independente.
async function salvarInstagramPending(postAccountId, pendingState) {
  await pool.query(`UPDATE post_accounts SET instagram_pending = $1 WHERE id = $2`, [JSON.stringify(pendingState), postAccountId])
}

async function limparInstagramPending(postAccountId) {
  await pool.query(`UPDATE post_accounts SET instagram_pending = NULL WHERE id = $1`, [postAccountId])
}

// Linhas de post_accounts com containers do Instagram aguardando confirmação
// de processamento — candidatas a serem finalizadas (media_publish) no
// próximo tick do cron. Uma linha por (post, conta) pendente.
async function listarPostsComInstagramPendente() {
  const { rows } = await pool.query(`
    SELECT pa.id AS "postAccountId", pa.account_id AS "accountId", pa.instagram_pending AS "instagramPending",
           p.id, p.text, p.platforms, p.status, p.user_id AS "userId"
    FROM post_accounts pa
    JOIN posts p ON p.id = pa.post_id
    WHERE pa.instagram_pending IS NOT NULL
  `)
  return rows
}

// Verifica se ainda existe alguma pendência de Instagram (de qualquer conta)
// para este post — usado para só fechar o status final do post quando TODAS
// as suas contas (de todas as redes) já saíram do estado pendente.
async function existePendenciaInstagramNoPost(postId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM post_accounts WHERE post_id = $1 AND instagram_pending IS NOT NULL LIMIT 1`,
    [postId]
  )
  return rows.length > 0
}

// Salva um snapshot diário das métricas de um post por rede (1 ponto por dia
// por rede), para alimentar o gráfico de curtidas ao longo do tempo — a API da
// rede social só dá o valor atual, então é o Analytics que constrói o
// histórico, dia a dia, a cada vez que busca métricas reais. Como um post pode
// estar em várias redes, o snapshot é por (post, rede) para uma não sobrescrever
// a outra no mesmo dia.
async function registrarSnapshotMetricas(postId, platform, { likes, comments, views }) {
  await pool.query(`
    INSERT INTO post_metrics_history (post_id, platform, captured_on, likes, comments, views)
    VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
    ON CONFLICT (post_id, platform, captured_on) DO UPDATE SET likes = $3, comments = $4, views = $5
  `, [postId, platform, likes ?? null, comments ?? null, views ?? null])
}

// Histórico diário de curtidas/comentários/views de um post, por rede, para o
// gráfico de linha no Analytics.
async function buscarHistoricoMetricas(postId) {
  const { rows } = await pool.query(`
    SELECT captured_on AS "date", platform, likes, comments, views
    FROM post_metrics_history
    WHERE post_id = $1
    ORDER BY captured_on ASC, platform ASC
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
  definirContasDoPost, listarContasDoPost,
  salvarPublicacaoExterna, listarPublicacoesDosPosts, listarPostsPublicadosSemExternalId, definirAccountIdSeVazio,
  salvarInstagramPending, limparInstagramPending, listarPostsComInstagramPendente, existePendenciaInstagramNoPost,
  registrarSnapshotMetricas, buscarHistoricoMetricas,
  listarPostsCalendario, reagendarPost
}
