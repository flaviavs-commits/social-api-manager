const pool = require('../db/pool')
const { canonicalBlobUrl, excluirBlobs } = require('../infra/storage/blobStorage')

const SUCCESS_RETENTION_HOURS = 48
const FAILURE_RETENTION_DAYS = 7
const DEFAULT_BATCH_SIZE = 100

// Um post só entra na limpeza quando não tem mais publicação pendente e o
// prazo calculado para a mídia já venceu. A mesma expressão é usada para
// ignorar, na checagem de referências, outros posts que serão limpos no mesmo
// ciclo — isso evita que dois posts que compartilham a mesma mídia se travem.
function eligiblePostPredicate(alias = 'p') {
  return `
    ${alias}.media_cleaned_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM post_accounts pending_pa
      WHERE pending_pa.post_id = ${alias}.id
        AND pending_pa.instagram_pending IS NOT NULL
    )
    AND (
      (
        ${alias}.status = 'published'
        AND COALESCE(
          ${alias}.media_cleanup_after,
          COALESCE(${alias}.published_at, ${alias}.criado_em) + INTERVAL '${SUCCESS_RETENTION_HOURS} hours'
        ) <= NOW()
      )
      OR (
        ${alias}.status IN ('partial', 'error', 'erro', 'failed', 'cancelled')
        AND COALESCE(
          ${alias}.media_cleanup_after,
          ${alias}.criado_em + INTERVAL '${FAILURE_RETENTION_DAYS} days'
        ) <= NOW()
      )
    )`
}

const CANDIDATE_POSTS_QUERY = `
  SELECT
    p.id,
    p.media_path AS "mediaPath",
    p.media_items AS "mediaItems",
    COALESCE(
      JSONB_AGG(pa.media_items) FILTER (WHERE pa.media_items IS NOT NULL),
      '[]'::jsonb
    ) AS "accountMediaItems"
  FROM posts p
  LEFT JOIN post_accounts pa ON pa.post_id = p.id
  WHERE ${eligiblePostPredicate('p')}
  GROUP BY p.id, p.media_path, p.media_items
  ORDER BY p.id ASC
  LIMIT $1
`

// Checa referências em posts ainda ativos, rascunhos, filas recorrentes e
// itens salvos na biblioteca. Uma mídia usada em qualquer desses lugares não
// pode ser apagada só porque uma publicação terminou.
const REFERENCES_QUERY = `
  SELECT url FROM (
    SELECT p.media_path AS url
    FROM posts p
    WHERE p.media_path = ANY($1::text[])
      AND NOT (${eligiblePostPredicate('p')})

    UNION ALL

    SELECT CASE WHEN item->>'path' = ANY($1::text[]) THEN item->>'path' ELSE item->>'url' END AS url
    FROM posts p
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.media_items) = 'array' THEN p.media_items ELSE '[]'::jsonb END
    ) AS item
    WHERE (item->>'path' = ANY($1::text[]) OR item->>'url' = ANY($1::text[]))
      AND NOT (${eligiblePostPredicate('p')})

    UNION ALL

    SELECT CASE WHEN item->>'path' = ANY($1::text[]) THEN item->>'path' ELSE item->>'url' END AS url
    FROM post_accounts pa
    JOIN posts p ON p.id = pa.post_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(pa.media_items) = 'array' THEN pa.media_items ELSE '[]'::jsonb END
    ) AS item
    WHERE (item->>'path' = ANY($1::text[]) OR item->>'url' = ANY($1::text[]))
      AND NOT (${eligiblePostPredicate('p')})

    UNION ALL

    SELECT d.media_path AS url
    FROM drafts d
    WHERE d.media_path = ANY($1::text[])

    UNION ALL

    SELECT CASE WHEN item->>'path' = ANY($1::text[]) THEN item->>'path' ELSE item->>'url' END AS url
    FROM drafts d
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(d.media_items) = 'array' THEN d.media_items ELSE '[]'::jsonb END
    ) AS item
    WHERE (item->>'path' = ANY($1::text[]) OR item->>'url' = ANY($1::text[]))

    UNION ALL

    SELECT CASE WHEN item->>'path' = ANY($1::text[]) THEN item->>'path' ELSE item->>'url' END AS url
    FROM drafts d
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(d.media_by_platform) = 'object' THEN d.media_by_platform ELSE '{}'::jsonb END
    ) AS platform_media
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(platform_media.value) = 'array' THEN platform_media.value ELSE '[]'::jsonb END
    ) AS item
    WHERE (item->>'path' = ANY($1::text[]) OR item->>'url' = ANY($1::text[]))

    UNION ALL

    SELECT c.content->>'mediaPath' AS url
    FROM content_queues c
    WHERE c.content->>'mediaPath' = ANY($1::text[])

    UNION ALL

    SELECT a.url
    FROM media_assets a
    WHERE a.url = ANY($1::text[])

    UNION ALL

    SELECT u.avatar_url AS url
    FROM users u
    WHERE u.avatar_url = ANY($1::text[])

    UNION ALL

    SELECT c.avatar_url AS url
    FROM contas c
    WHERE c.avatar_url = ANY($1::text[])

    UNION ALL

    SELECT s.theme->>'logoUrl' AS url
    FROM smartlinks s
    WHERE s.theme->>'logoUrl' = ANY($1::text[])

    UNION ALL

    SELECT r.branding->>'logoUrl' AS url
    FROM report_schedules r
    WHERE r.branding->>'logoUrl' = ANY($1::text[])

    UNION ALL

    SELECT w.branding->>'logoUrl' AS url
    FROM workspaces w
    WHERE w.branding->>'logoUrl' = ANY($1::text[])
  ) AS references_found
  WHERE url IS NOT NULL
`

function parseJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

function collectBlobUrls(row) {
  const targets = new Set()
  const references = new Set()

  const add = value => {
    if (typeof value !== 'string' || !value.trim()) return
    const target = canonicalBlobUrl(value.trim())
    if (!target) return
    targets.add(target)
    references.add(value.trim())
    references.add(target)
  }

  const collectItems = value => {
    const parsed = parseJson(value)
    if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        if (Array.isArray(item)) {
          collectItems(item)
          return
        }
        if (!item || typeof item !== 'object') return
        add(item.path)
        add(item.url)
      })
      return
    }
    if (parsed && typeof parsed === 'object') {
      add(parsed.path)
      add(parsed.url)
    }
  }

  add(row.mediaPath)
  collectItems(row.mediaItems)
  collectItems(row.accountMediaItems)

  return { targets, references }
}

async function marcarPostsLimpos(postIds) {
  if (!postIds.length) return 0
  const { rowCount } = await pool.query(
    'UPDATE posts SET media_cleaned_at = NOW() WHERE id = ANY($1::int[]) AND media_cleaned_at IS NULL',
    [postIds]
  )
  return rowCount || 0
}

async function limparMidiasExpiradas({ limit = DEFAULT_BATCH_SIZE } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || DEFAULT_BATCH_SIZE))
  const { rows: candidates } = await pool.query(CANDIDATE_POSTS_QUERY, [safeLimit])
  if (!candidates.length) {
    return { candidates: 0, deleted: 0, deferred: 0, marked: 0, errors: 0 }
  }

  const entries = candidates.map(row => ({
    id: row.id,
    ...collectBlobUrls(row)
  }))
  const allReferences = Array.from(new Set(entries.flatMap(entry => Array.from(entry.references))))

  const referencedTargets = new Set()
  if (allReferences.length) {
    const { rows: references } = await pool.query(REFERENCES_QUERY, [allReferences])
    for (const reference of references) {
      const target = canonicalBlobUrl(reference.url)
      if (target) referencedTargets.add(target)
    }
  }

  const deletableTargets = new Set()
  let deferred = 0
  const cleanableIds = []
  for (const entry of entries) {
    const deferredTargets = Array.from(entry.targets).filter(target => referencedTargets.has(target))
    if (deferredTargets.length) deferred += deferredTargets.length
    else cleanableIds.push(entry.id)

    for (const target of entry.targets) {
      if (!referencedTargets.has(target)) deletableTargets.add(target)
    }
  }

  let deleted = 0
  let errors = 0
  if (deletableTargets.size) {
    try {
      deleted = await excluirBlobs(Array.from(deletableTargets))
    } catch (error) {
      errors = 1
      console.error('Falha ao excluir mídias expiradas do Vercel Blob:', error.message)
    }
  }

  // Sem confirmação da exclusão, mantém os posts elegíveis para uma nova
  // tentativa no próximo ciclo. Posts sem Blob ou sem referências externas
  // podem ser marcados como concluídos normalmente.
  const idsToMark = errors
    ? cleanableIds.filter(id => !entries.find(entry => entry.id === id)?.targets.size)
    : cleanableIds
  const marked = await marcarPostsLimpos(idsToMark)

  return {
    candidates: candidates.length,
    deleted,
    deferred,
    marked,
    errors
  }
}

module.exports = {
  SUCCESS_RETENTION_HOURS,
  FAILURE_RETENTION_DAYS,
  DEFAULT_BATCH_SIZE,
  eligiblePostPredicate,
  collectBlobUrls,
  limparMidiasExpiradas
}
