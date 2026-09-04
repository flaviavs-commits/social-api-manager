const pool = require('../../db/pool')
const crypto = require('crypto')

async function criarPost({ text, textByPlatform = null, titleByPlatform = null, platforms, scheduledAt, repeat = 'none', mediaPath = null, mediaType = null, mediaItems = null, coverPath = null, coverType = null, youtubeTitle = null, youtubeVisibility = 'public', youtubeCategoryId = null, youtubeFormat = null, youtubeIsShort = null, youtubeMadeForKids = null, igFormat = null, facebookFormat = null, tiktokPrivacyLevel = null, tiktokDisableComment = null, tiktokDisableDuet = null, tiktokDisableStitch = null, locationId = null, locationName = null, firstComment = null, accountId = null, userId, status = 'scheduled' }) {
  const { rows } = await pool.query(`
    INSERT INTO posts (text, text_by_platform, title_by_platform, platforms, scheduled_at, repeat, media_path, media_type, media_items, youtube_title, youtube_visibility, youtube_category_id, youtube_format, youtube_is_short, youtube_made_for_kids, ig_format, facebook_format, tiktok_privacy_level, tiktok_disable_comment, tiktok_disable_duet, tiktok_disable_stitch, location_id, location_name, first_comment, account_id, user_id, status, cover_path, cover_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
    RETURNING *, text_by_platform AS "textByPlatform", title_by_platform AS "titleByPlatform",
      youtube_title AS "youtubeTitle", youtube_visibility AS "youtubeVisibility", youtube_category_id AS "youtubeCategoryId",
      youtube_format AS "youtubeFormat", youtube_is_short AS "youtubeIsShort", youtube_made_for_kids AS "youtubeMadeForKids",
      ig_format AS "igFormat", facebook_format AS "facebookFormat",
      tiktok_privacy_level AS "tiktokPrivacyLevel", tiktok_disable_comment AS "tiktokDisableComment",
      tiktok_disable_duet AS "tiktokDisableDuet", tiktok_disable_stitch AS "tiktokDisableStitch",
      location_id AS "locationId", location_name AS "locationName", first_comment AS "firstComment",
      cover_path AS "coverPath", cover_type AS "coverType"
  `, [text, textByPlatform ? JSON.stringify(textByPlatform) : null, titleByPlatform ? JSON.stringify(titleByPlatform) : null, platforms, scheduledAt, repeat, mediaPath, mediaType, mediaItems ? JSON.stringify(mediaItems) : null, youtubeTitle, youtubeVisibility, youtubeCategoryId, youtubeFormat, youtubeIsShort, youtubeMadeForKids, igFormat, facebookFormat, tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch, locationId, locationName, firstComment, accountId, userId, status, coverPath, coverType])
  return rows[0]
}

// Associa as contas resolvidas (uma por conta conectada de cada rede
// marcada) a um post recém-criado — ver domain/posts, criarPost.js e
// migrations/027_post_accounts.sql. Um post pode ter N contas, inclusive
// várias da mesma rede (ex.: 2 perfis de Instagram publicando juntos).
//
// mediaItemsByPlatform (opcional) grava a mídia independente de cada rede
// (ver migrations/035) — todas as contas da mesma rede recebem a mesma
// mídia. Sem entrada para a rede (ou parâmetro omitido), a conta fica com
// media_items NULL e usa a mídia compartilhada do post (fallback em
// publisher.js/publicarNaConta) — comportamento idêntico ao de antes desta coluna existir.
async function definirContasDoPost(postId, contas, mediaItemsByPlatform = {}) {
  if (!contas.length) return
  const values = contas.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ')
  const params = contas.flatMap(c => [
    c.accountId ?? c.id,
    mediaItemsByPlatform[c.platform] ? JSON.stringify(mediaItemsByPlatform[c.platform]) : null
  ])
  await pool.query(
    `INSERT INTO post_accounts (post_id, account_id, media_items) VALUES ${values}
     ON CONFLICT (post_id, account_id) DO UPDATE SET media_items = EXCLUDED.media_items`,
    [postId, ...params]
  )
}

// Contas associadas a um post, com a plataforma da conta e a mídia
// independente daquela conta (se houver) — usado para reidratar
// post.accounts em reservarPostsPendentes/buscarPostPorId, já que
// publishPost() agora itera por (conta, rede) em vez de só por rede.
async function listarContasDoPost(postId) {
  const { rows } = await pool.query(`
    SELECT pa.id AS "postAccountId", pa.account_id AS "accountId", pa.provider_request_id AS "providerRequestId",
           pa.publication_confirmed AS "publicationConfirmed", c.platform, c.handle,
           c.zernio_account_id AS "zernioAccountId",
           c.avatar_url AS "avatarUrl",
           pa.media_items AS "mediaItems",
           pa.publication_error AS "publicationError"
    FROM post_accounts pa
    JOIN contas c ON c.id = pa.account_id
    WHERE pa.post_id = $1
  `, [postId])
  return rows
}

async function listarPosts({ status, userId, isAdmin, page, limit } = {}) {
  const conds = []
  const params = []
  if (status) { params.push(status); conds.push(`status = $${params.length}`) }
  if (userId !== null && userId !== undefined) {
    params.push(userId)
    conds.push(`user_id = $${params.length}`)
  } else if (!isAdmin) conds.push('FALSE')
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const paginate = page !== undefined || limit !== undefined
  const safePage = Math.max(1, Math.min(10000, Number.parseInt(page, 10) || 1))
  const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 100))
  const paginationSql = paginate ? (() => {
    params.push(safeLimit + 1)
    const limitParam = `$${params.length}`
    params.push((safePage - 1) * safeLimit)
    const offsetParam = `$${params.length}`
    return `LIMIT ${limitParam} OFFSET ${offsetParam}`
  })() : ''
  const { rows } = await pool.query(`
    SELECT
      id, text, text_by_platform AS "textByPlatform", title_by_platform AS "titleByPlatform", platforms,
      scheduled_at AS "scheduledAt", repeat, status, error_message AS "errorMessage", retry_count AS "retryCount", next_retry_at AS "nextRetryAt", criado_em, user_id AS "userId",
      media_path AS "mediaPath", media_type AS "mediaType", media_items AS "mediaItems", cover_path AS "coverPath", cover_type AS "coverType",
      youtube_title AS "youtubeTitle", youtube_visibility AS "youtubeVisibility", youtube_category_id AS "youtubeCategoryId", youtube_format AS "youtubeFormat", youtube_is_short AS "youtubeIsShort", youtube_made_for_kids AS "youtubeMadeForKids",
      ig_format AS "igFormat", facebook_format AS "facebookFormat", tiktok_privacy_level AS "tiktokPrivacyLevel", tiktok_disable_comment AS "tiktokDisableComment", tiktok_disable_duet AS "tiktokDisableDuet", tiktok_disable_stitch AS "tiktokDisableStitch",
      account_id AS "accountId",
      external_post_id AS "externalPostId", external_platform AS "externalPlatform", published_at AS "publishedAt"
    FROM posts
    ${where}
    ORDER BY scheduled_at ASC NULLS LAST, id ASC
    ${paginationSql}
  `, params)
  return paginate ? { posts: rows.slice(0, safeLimit), page: safePage, limit: safeLimit, hasMore: rows.length > safeLimit } : rows
}

async function deletarPost(id, userId, isAdmin) {
  const post = await buscarPostPorId(id, userId, isAdmin)
  if (!post) return false
  const { rowCount } = await pool.query(
    `UPDATE posts
        SET status='cancelled',
            media_cleanup_after = NOW() + INTERVAL '7 days',
            media_cleaned_at = NULL
      WHERE id=$1 AND status IN ('scheduled', 'pending_approval', 'rejected', 'published', 'error', 'erro', 'failed', 'partial')`, [id]
  )
  return rowCount > 0
}

async function buscarPostPorId(id, userId, isAdmin) {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.text, p.text_by_platform AS "textByPlatform", p.title_by_platform AS "titleByPlatform", p.platforms,
      p.scheduled_at AS "scheduledAt", p.repeat, p.status, p.criado_em, p.user_id AS "userId",
      p.media_path AS "mediaPath", p.media_type AS "mediaType", p.media_items AS "mediaItems", p.cover_path AS "coverPath", p.cover_type AS "coverType",
      p.youtube_title AS "youtubeTitle", p.youtube_visibility AS "youtubeVisibility", p.youtube_category_id AS "youtubeCategoryId", p.youtube_format AS "youtubeFormat", p.youtube_is_short AS "youtubeIsShort",
      p.youtube_made_for_kids AS "youtubeMadeForKids",
      p.ig_format AS "igFormat", p.facebook_format AS "facebookFormat",
      p.tiktok_privacy_level AS "tiktokPrivacyLevel", p.tiktok_disable_comment AS "tiktokDisableComment",
      p.tiktok_disable_duet AS "tiktokDisableDuet", p.tiktok_disable_stitch AS "tiktokDisableStitch",
      p.account_id AS "accountId",
      p.external_post_id AS "externalPostId", p.external_platform AS "externalPlatform", p.published_at AS "publishedAt",
      u.role AS "userRole",
      COALESCE(
        JSON_AGG(JSON_BUILD_OBJECT('postAccountId', pa.id, 'accountId', pa.account_id, 'providerRequestId', pa.provider_request_id, 'platform', c.platform, 'handle', c.handle, 'avatarUrl', c.avatar_url, 'mediaItems', pa.media_items))
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
  if (userId !== null && userId !== undefined && post.userId !== userId) return null
  if ((userId === null || userId === undefined) && !isAdmin) return null
  return post
}

async function atualizarStatusPost(id, status, errorMessage = null) {
  // Limpa next_retry_at ao fechar o post num status final — evita confusão
  // caso o post seja reagendado manualmente depois (ver reagendarParaRetry).
  await pool.query(`
    UPDATE posts
       SET status = $1::varchar,
           error_message = $2,
           next_retry_at = NULL,
           media_cleanup_after = CASE
             WHEN $1::varchar = 'published' THEN NOW() + INTERVAL '48 hours'
             WHEN $1::varchar IN ('partial', 'error', 'erro', 'failed', 'cancelled') THEN NOW() + INTERVAL '7 days'
             ELSE NULL
           END,
           media_cleaned_at = CASE
             WHEN $1::varchar IN ('scheduled', 'processing') THEN NULL
             ELSE media_cleaned_at
           END
     WHERE id = $3
  `, [status, errorMessage, id])
}

// Fecha o post somente se ele ainda estiver em processamento. Webhooks por
// plataforma e o evento rollup da Zernio podem chegar ambos para a mesma
// publicação; o UPDATE condicional evita log/notificação duplicados.
async function atualizarStatusPostSeProcessando(id, status, errorMessage = null) {
  const result = await pool.query(`
    UPDATE posts
       SET status = $1::varchar,
           error_message = $2,
           next_retry_at = NULL,
           media_cleanup_after = CASE
             WHEN $1::varchar = 'published' THEN NOW() + INTERVAL '48 hours'
             WHEN $1::varchar IN ('partial', 'error', 'erro', 'failed', 'cancelled') THEN NOW() + INTERVAL '7 days'
             ELSE NULL
           END,
           media_cleaned_at = CASE
             WHEN $1::varchar IN ('scheduled', 'processing') THEN NULL
             ELSE media_cleaned_at
           END
     WHERE id = $3 AND status = 'processing'
     RETURNING id
  `, [status, errorMessage, id])
  // O fallback para undefined mantém os mocks antigos compatíveis; o driver
  // do Postgres sempre fornece rowCount em produção.
  return result.rowCount === undefined ? result.rows?.length !== 0 : result.rowCount > 0
}

async function atualizarErroPublicacaoConta(postAccountId, message = null) {
  if (!postAccountId) return
  await pool.query('UPDATE post_accounts SET publication_error = $1 WHERE id = $2', [message, postAccountId])
}

async function marcarContaPublicada(postAccountId) {
  if (!postAccountId) return
  await pool.query('UPDATE post_accounts SET publication_confirmed = TRUE WHERE id = $1', [postAccountId])
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
        -- Pega tanto posts agendados no horário normal quanto posts que
        -- falharam por erro transitório e estão aguardando o retry (ver
        -- reagendarParaRetry, migrations/036) — o segundo caso sempre tem
        -- next_retry_at preenchido, então uma condição não interfere na outra.
        WHERE p.status = 'scheduled' AND (p.scheduled_at <= NOW() OR p.next_retry_at <= NOW())
        -- Segura o post se TODAS as suas plataformas estiverem fora do ar;
        -- volta a tentar no próximo tick do cron (1 min depois) até
        -- alguma plataforma voltar a responder ('up' ou 'unknown').
        AND EXISTS (
          SELECT 1 FROM unnest(p.platforms) AS plat
          WHERE plat NOT IN (SELECT platform FROM platform_health WHERE status = 'down')
        )
      )
      RETURNING
        id, text, text_by_platform, title_by_platform, platforms, scheduled_at, repeat, status, user_id,
        media_path, media_type, media_items, cover_path, cover_type,
        youtube_title, youtube_visibility, youtube_category_id, youtube_format, youtube_is_short, youtube_made_for_kids,
        ig_format, facebook_format, tiktok_privacy_level, tiktok_disable_comment, tiktok_disable_duet, tiktok_disable_stitch, account_id,
        retry_count, location_id, location_name, first_comment
    )
    SELECT
      r.id, r.text, r.text_by_platform AS "textByPlatform", r.title_by_platform AS "titleByPlatform", r.platforms,
      r.scheduled_at AS "scheduledAt", r.repeat, r.status, r.user_id AS "userId",
      r.media_path AS "mediaPath", r.media_type AS "mediaType", r.media_items AS "mediaItems", r.cover_path AS "coverPath", r.cover_type AS "coverType",
      r.youtube_title AS "youtubeTitle", r.youtube_visibility AS "youtubeVisibility", r.youtube_category_id AS "youtubeCategoryId", r.youtube_format AS "youtubeFormat", r.youtube_is_short AS "youtubeIsShort",
      r.youtube_made_for_kids AS "youtubeMadeForKids",
      r.ig_format AS "igFormat", r.facebook_format AS "facebookFormat",
      r.tiktok_privacy_level AS "tiktokPrivacyLevel", r.tiktok_disable_comment AS "tiktokDisableComment",
      r.tiktok_disable_duet AS "tiktokDisableDuet", r.tiktok_disable_stitch AS "tiktokDisableStitch",
      r.account_id AS "accountId",
      r.retry_count AS "retryCount",
      r.location_id AS "locationId", r.location_name AS "locationName", r.first_comment AS "firstComment",
      u.role AS "userRole",
      COALESCE(
        JSON_AGG(JSON_BUILD_OBJECT('postAccountId', pa.id, 'accountId', pa.account_id, 'providerRequestId', pa.provider_request_id, 'platform', c.platform, 'handle', c.handle, 'avatarUrl', c.avatar_url, 'mediaItems', pa.media_items))
          FILTER (WHERE pa.id IS NOT NULL),
        '[]'
      ) AS accounts
    FROM reservados r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN post_accounts pa ON pa.post_id = r.id
    LEFT JOIN contas c ON c.id = pa.account_id
    GROUP BY r.id, r.text, r.text_by_platform, r.title_by_platform, r.platforms, r.scheduled_at, r.repeat, r.status, r.user_id,
             r.media_path, r.media_type, r.media_items, r.cover_path, r.cover_type, r.youtube_title, r.youtube_visibility,
             r.youtube_category_id, r.youtube_format, r.youtube_is_short, r.youtube_made_for_kids, r.ig_format, r.facebook_format,
             r.tiktok_privacy_level, r.tiktok_disable_comment, r.tiktok_disable_duet, r.tiktok_disable_stitch, r.account_id, r.retry_count,
             r.location_id, r.location_name, r.first_comment, u.role
  `)
  return rows
}

// Recupera reservas que sobreviveram a uma queda/redeploy sem confirmação
// externa. O limite evita que uma publicação legitimamente lenta fique presa
// indefinidamente, mas não tenta republicar automaticamente e causar duplicata.
async function recuperarPostsProcessingStale() {
  const { rows } = await pool.query(`
    UPDATE posts p
       SET status = 'error',
           error_message = 'Processamento interrompido; publicação precisa ser revisada.',
           next_retry_at = NULL,
           media_cleanup_after = NOW() + INTERVAL '7 days',
           media_cleaned_at = NULL
     WHERE p.status = 'processing'
       AND p.criado_em < NOW() - INTERVAL '6 hours'
       AND NOT EXISTS (SELECT 1 FROM post_accounts pa WHERE pa.post_id = p.id AND pa.instagram_pending IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM post_publications pp WHERE pp.post_id = p.id)
     RETURNING p.id, p.user_id AS "userId"
  `)
  return rows
}

// Gera o identificador uma única vez. O COALESCE torna a operação segura se
// duas instâncias tentarem iniciar a mesma publicação simultaneamente: ambas
// recebem o valor persistido, e todos os retries usam a mesma chave.
async function obterProviderRequestId(postAccountId) {
  const candidate = crypto.randomUUID()
  const { rows: [row] } = await pool.query(`
    UPDATE post_accounts
       SET provider_request_id = COALESCE(provider_request_id, $2)
     WHERE id = $1
     RETURNING provider_request_id AS "providerRequestId"
  `, [postAccountId, candidate])
  if (!row?.providerRequestId) throw new Error('Conta da publicação não encontrada ao reservar a chave de idempotência')
  return row.providerRequestId
}

// Reagenda um post que falhou por erro transitório (ver isErroTransitorio em
// publisher.js) para uma nova tentativa automática — incrementa retry_count e
// mantém o status 'scheduled' (reservarPostsPendentes volta a pegá-lo quando
// next_retry_at chegar). Diferente de um post normal, o campo scheduled_at
// original não muda — serve só de referência histórica de quando deveria ter
// sido publicado.
async function reagendarParaRetry(id, nextRetryAt) {
  await pool.query(
    `UPDATE posts SET status = 'scheduled', retry_count = retry_count + 1, next_retry_at = $1 WHERE id = $2`,
    [nextRetryAt.toISOString(), id]
  )
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
// Redes com endpoint de comentário na API oficial, publicado via este fluxo
// separado (cron, depois do post já estar no ar) — só o YouTube ainda usa
// esse caminho. Facebook/Instagram/TikTok migraram para o Zernio, que posta
// o firstComment nativamente no momento da publicação (ver
// src/infra/social/zernioPublisher.js) — colocar essas redes aqui de novo
// duplicaria o comentário ou falharia, já que o token guardado para elas
// não é mais um access_token real da Graph API/Content Posting API.
const PLATAFORMAS_COM_COMENTARIO = ['youtube']

async function salvarPublicacaoExterna(id, { externalPostId, externalPlatform, publishedAt, accountId = null, firstCommentHandled = false }) {
  // accountId sempre vem preenchido no fluxo atual (publisher.js resolve a
  // conta antes de chamar isto) — o índice único parcial em post_publications
  // só cobre account_id IS NOT NULL, então esse é o caminho de conflito real.
  // O ramo sem accountId existe só por segurança (nunca deveria ser
  // exercitado), e não tenta ON CONFLICT (não há índice único para colidir).
  let publicationId
  if (accountId) {
    const { rows } = await pool.query(
      `INSERT INTO post_publications (post_id, platform, external_post_id, published_at, account_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id, platform, account_id) WHERE account_id IS NOT NULL
         DO UPDATE SET external_post_id = EXCLUDED.external_post_id, published_at = EXCLUDED.published_at
       RETURNING id`,
      [id, externalPlatform, externalPostId, publishedAt, accountId]
    )
    publicationId = rows[0]?.id
  } else {
    const { rows } = await pool.query(
      `INSERT INTO post_publications (post_id, platform, external_post_id, published_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [id, externalPlatform, externalPostId, publishedAt]
    )
    publicationId = rows[0]?.id
  }
  await pool.query(
    `UPDATE posts
     SET external_post_id = $1, external_platform = $2, published_at = COALESCE(published_at, $3)
     WHERE id = $4 AND external_post_id IS NULL`,
    [externalPostId, externalPlatform, publishedAt, id]
  )

  // Programa o primeiro comentário automático para esta publicação
  // específica, se o post tiver um texto definido e a rede suportar
  // comentário via API — o cron (services/scheduler.js) executa de fato.
  if (publicationId && PLATAFORMAS_COM_COMENTARIO.includes(externalPlatform) && !firstCommentHandled) {
    const { rows: [post] } = await pool.query(`SELECT first_comment FROM posts WHERE id = $1`, [id])
    if (post?.first_comment) {
      await pool.query(
        `INSERT INTO post_first_comments (post_publication_id) VALUES ($1) ON CONFLICT (post_publication_id) DO NOTHING`,
        [publicationId]
      )
    }
  }
}

// Publicações com primeiro comentário pendente de postar — chamado a cada
// tick do cron (services/scheduler.js). Traz tudo que o publisher precisa:
// plataforma, ID externo do post/mídia, texto do comentário e a conta certa
// (para resolver o token na hora de publicar).
async function listarPrimeirosComentariosPendentes() {
  const { rows } = await pool.query(`
    SELECT
      fc.id AS "firstCommentId", pp.platform, pp.external_post_id AS "externalPostId",
      pp.account_id AS "accountId", p.first_comment AS "firstComment", p.user_id AS "userId", u.role AS "userRole"
    FROM post_first_comments fc
    JOIN post_publications pp ON pp.id = fc.post_publication_id
    JOIN posts p ON p.id = pp.post_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE fc.status = 'pending'
  `)
  return rows
}

async function atualizarStatusPrimeiroComentario(id, status, errorMessage = null) {
  await pool.query(
    `UPDATE post_first_comments SET status = $1, error_message = $2, atualizado_em = NOW() WHERE id = $3`,
    [status, errorMessage, id]
  )
}

// Todas as publicações (uma por rede) dos posts informados, para o Analytics
// montar uma entrada de métricas por (post, rede) em vez de só uma por post.
async function listarPublicacoesDosPosts(postIds) {
  if (!postIds.length) return []
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (post_id, platform, external_post_id)
            post_id AS "postId", platform, account_id AS "accountId", external_post_id AS "externalPostId", published_at AS "publishedAt"
     FROM post_publications
     WHERE post_id = ANY($1) AND external_post_id IS NOT NULL
     ORDER BY post_id, platform, external_post_id,
              (account_id IS NOT NULL) DESC, id DESC`,
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
  if (userId !== null && userId !== undefined) {
    params.push(userId)
    conds.push(`user_id = $${params.length}`)
  } else if (!isAdmin) conds.push('FALSE')

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
  const safeState = { ...(pendingState || {}) }
  delete safeState.accessToken
  delete safeState.refreshToken
  await pool.query(`UPDATE post_accounts SET instagram_pending = $1 WHERE id = $2`, [JSON.stringify(safeState), postAccountId])
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
           p.id, p.text, p.platforms, p.status, p.user_id AS "userId", u.role AS "userRole"
    FROM post_accounts pa
    JOIN posts p ON p.id = pa.post_id
    LEFT JOIN users u ON u.id = p.user_id
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

// Pendências do Zernio são indexadas pelo ID do post agrupador retornado por
// POST /v1/posts. O ID é a ponte entre o callback externo e o post local.
async function listarPostsComZernioPendentePorPostId(zernioPostId) {
  const { rows } = await pool.query(`
    SELECT pa.id AS "postAccountId", pa.account_id AS "accountId",
           pa.instagram_pending AS "instagramPending",
           pa.publication_error AS "publicationError",
           p.id, p.text, p.platforms, p.status, p.user_id AS "userId",
           u.role AS "userRole", c.platform, c.handle,
           c.zernio_account_id AS "zernioAccountId"
    FROM post_accounts pa
    JOIN posts p ON p.id = pa.post_id
    JOIN contas c ON c.id = pa.account_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE pa.instagram_pending->>'provider' = 'zernio'
      AND pa.instagram_pending->>'zernioPostId' = $1
  `, [String(zernioPostId)])
  return rows
}

// Usa o metadata devolvido pelo webhook como vínculo primário. Os valores
// numéricos são validados antes de entrar nos parâmetros para que um metadata
// malformado nunca amplie a consulta para outro cliente.
async function listarPostsComZernioPendentePorMetadata({ zernioPostId, postId, postAccountId, clienteId, platform } = {}) {
  const providerId = String(zernioPostId || '').trim()
  if (!providerId) return []

  const conds = [
    `pa.instagram_pending->>'provider' = 'zernio'`,
    `pa.instagram_pending->>'zernioPostId' = $1`
  ]
  const params = [providerId]
  const addPositiveInteger = (value, sql) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) return
    params.push(parsed)
    conds.push(`${sql} = $${params.length}`)
  }

  addPositiveInteger(postId, 'p.id')
  addPositiveInteger(postAccountId, 'pa.id')
  addPositiveInteger(clienteId, 'p.user_id')
  if (typeof platform === 'string' && platform.trim()) {
    params.push(platform.trim().toLowerCase())
    conds.push(`c.platform = $${params.length}`)
  }

  // Metadata sem nenhuma chave local não é uma correlação; o chamador pode
  // então cair no lookup legado somente pelo ID do post Zernio.
  if (params.length === 1) return []

  const { rows } = await pool.query(`
    SELECT pa.id AS "postAccountId", pa.account_id AS "accountId",
           pa.instagram_pending AS "instagramPending",
           pa.publication_error AS "publicationError",
           p.id, p.text, p.platforms, p.status, p.user_id AS "userId",
           u.role AS "userRole", c.platform, c.handle,
           c.zernio_account_id AS "zernioAccountId"
    FROM post_accounts pa
    JOIN posts p ON p.id = pa.post_id
    JOIN contas c ON c.id = pa.account_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE ${conds.join(' AND ')}
  `, params)
  return rows
}

// Último snapshot conhecido de cada (post, rede). O Analytics usa este
// resultado quando a publicação não entra na pequena janela de atualização
// ao vivo, evitando uma chamada externa por publicação a cada refresh.
async function listarUltimosSnapshotsMetricas(postIds) {
  if (!postIds.length) return []
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (post_id, platform)
           post_id AS "postId", platform, captured_on AS "capturedOn",
           likes, comments, views
    FROM post_metrics_history
    WHERE post_id = ANY($1)
    ORDER BY post_id, platform, captured_on DESC
  `, [postIds])
  return rows
}

// Retorna todos os posts de um mês/ano específico (agendados, publicados, erro, etc.)
// para alimentar o calendário. Exclui apenas cancelados.
async function listarPostsCalendario({ year, month, userId, isAdmin }) {
  // month é 1-based (1=janeiro, 12=dezembro)
  // As datas ficam armazenadas como UTC em colunas sem timezone. O filtro
  // deve representar meia-noite de Brasília para o mês exibido.
  const inicio = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00-03:00`)
  const fim    = new Date(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01T00:00:00-03:00`)

  // O calendário usa o horário efetivo: posts publicados agora entram pelo
  // published_at; os que ainda aguardam publicação entram pelo scheduled_at.
  // Assim o mesmo post aparece uma única vez no dia e horário em que de fato
  // foi publicado/agendado.
  const calendarDate = `COALESCE(published_at, scheduled_at)`
  const conds  = [`${calendarDate} >= $1`, `${calendarDate} < $2`, `status <> 'cancelled'`]
  const params = [inicio.toISOString().replace('Z', ''), fim.toISOString().replace('Z', '')]

  if (userId !== null && userId !== undefined) {
    params.push(userId)
    conds.push(`user_id = $${params.length}`)
  } else if (!isAdmin) conds.push('FALSE')

  const { rows } = await pool.query(`
    SELECT
      id, text, text_by_platform AS "textByPlatform", title_by_platform AS "titleByPlatform", platforms, status, repeat,
      error_message AS "errorMessage",
      scheduled_at  AS "scheduledAt",
      published_at  AS "publishedAt",
      ${calendarDate} AS "calendarAt",
      media_path    AS "mediaPath",
      media_type    AS "mediaType",
      media_items   AS "mediaItems",
      youtube_title AS "youtubeTitle",
      youtube_visibility AS "youtubeVisibility",
      youtube_category_id AS "youtubeCategoryId",
      youtube_format AS "youtubeFormat",
      youtube_made_for_kids AS "youtubeMadeForKids",
      ig_format AS "igFormat", facebook_format AS "facebookFormat",
      tiktok_privacy_level AS "tiktokPrivacyLevel",
      tiktok_disable_comment AS "tiktokDisableComment",
      tiktok_disable_duet AS "tiktokDisableDuet",
      tiktok_disable_stitch AS "tiktokDisableStitch",
      account_id    AS "accountId",
      user_id       AS "userId"
    FROM posts
    WHERE ${conds.join(' AND ')}
    ORDER BY ${calendarDate} ASC
  `, params)
  return rows
}

async function reagendarPost({ id, scheduledAt, userId, isAdmin }) {
  const hasUserScope = userId !== null && userId !== undefined
  const ownerFilter = hasUserScope ? 'AND user_id = $3' : (isAdmin ? '' : 'AND FALSE')
  const { rows } = await pool.query(
    `WITH updated AS (
      UPDATE posts
         SET scheduled_at = $1,
             status = CASE
               WHEN status IN ('error', 'erro', 'failed') THEN 'scheduled'
               ELSE status
             END,
             error_message = NULL,
             next_retry_at = NULL,
             media_cleanup_after = NULL,
             media_cleaned_at = NULL
       WHERE id = $2
         AND status IN ('scheduled', 'agendado', 'error', 'erro', 'failed')
         ${ownerFilter}
       RETURNING id, scheduled_at AS "scheduledAt", status
    ), cleared_accounts AS (
      UPDATE post_accounts
         SET publication_error = NULL
       WHERE post_id IN (SELECT id FROM updated)
       RETURNING post_id
    )
    SELECT id, "scheduledAt", status FROM updated`,
    hasUserScope ? [scheduledAt, id, userId] : [scheduledAt, id]
  )
  return rows[0] || null
}

module.exports = {
  criarPost, listarPosts, deletarPost, buscarPostPorId, atualizarStatusPost, atualizarStatusPostSeProcessando,
  reservarPostsPendentes, recuperarPostsProcessingStale, reagendarParaRetry,
  definirContasDoPost, listarContasDoPost, atualizarErroPublicacaoConta, marcarContaPublicada,
  obterProviderRequestId,
  salvarPublicacaoExterna, listarPublicacoesDosPosts, listarPostsPublicadosSemExternalId, definirAccountIdSeVazio,
  listarPrimeirosComentariosPendentes, atualizarStatusPrimeiroComentario,
  salvarInstagramPending, limparInstagramPending, listarPostsComInstagramPendente, listarPostsComZernioPendentePorPostId, listarPostsComZernioPendentePorMetadata, existePendenciaInstagramNoPost,
  registrarSnapshotMetricas, buscarHistoricoMetricas, listarUltimosSnapshotsMetricas,
  listarPostsCalendario, reagendarPost
}
