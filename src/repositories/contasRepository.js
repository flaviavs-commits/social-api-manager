const pool = require('../db/pool')
const { decrypt } = require('../services/tokenCrypto')

// ── Stats para o dashboard ────────────────────────────────────────────────────
async function getDashboardStats(userId, isAdmin) {
  // Atualiza status dos tokens antes de calcular — só escreve as linhas cujo
  // status mudou (evita reescrever a tabela inteira a cada carregamento do
  // dashboard, que antes rodava sem WHERE e tocava toda linha com expires_at).
  await pool.query(`
    UPDATE tokens SET status =
      CASE
        WHEN expires_at < NOW()                        THEN 'expired'
        WHEN expires_at < NOW() + INTERVAL '7 days'   THEN 'expiring'
        ELSE 'valid'
      END
    WHERE expires_at IS NOT NULL
      AND status IS DISTINCT FROM (
        CASE
          WHEN expires_at < NOW()                      THEN 'expired'
          WHEN expires_at < NOW() + INTERVAL '7 days' THEN 'expiring'
          ELSE 'valid'
        END
      )
  `)

  const ownerFilter = isAdmin ? '' : `WHERE c.user_id = $1`
  const ownerParams = isAdmin ? [] : [userId]

  // Totais gerais
  const { rows: [summary] } = await pool.query(`
    SELECT
      COUNT(DISTINCT c.id)                                              AS "totalAccounts",
      COUNT(*) FILTER (WHERE t.status = 'valid')                       AS "validTokensTotal",
      COUNT(*) FILTER (WHERE t.status = 'expiring')                    AS "expiringTokensTotal",
      COUNT(*) FILTER (WHERE t.status IN ('expired','error'))          AS "errorTotal"
    FROM contas c
    LEFT JOIN tokens t ON t.conta_id = c.id
    ${ownerFilter}
  `, ownerParams)

  // Totais por plataforma
  const { rows: platforms } = await pool.query(`
    SELECT
      t.platform,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE t.status = 'valid')           AS active,
      COUNT(*) FILTER (WHERE t.status = 'expiring')        AS "expiringTokens",
      COUNT(*) FILTER (WHERE t.status IN ('expired','error')) AS error
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    ${ownerFilter}
    GROUP BY t.platform
    ORDER BY t.platform
  `, ownerParams)

  return {
    summary: {
      totalAccounts:      Number(summary.totalAccounts),
      validTokensTotal:   Number(summary.validTokensTotal),
      expiringTokensTotal:Number(summary.expiringTokensTotal),
      errorTotal:         Number(summary.errorTotal),
    },
    platforms: platforms.map(p => ({
      platform:       p.platform,
      total:          Number(p.total),
      active:         Number(p.active),
      expiringTokens: Number(p.expiringTokens),
      error:          Number(p.error),
    }))
  }
}

// ── Listar contas com tokens ───────────────────────────────────────────────────
async function listarContas({ platform, tipo, ativo, userId, isAdmin } = {}) {
  const conds = []
  const params = []

  if (!isAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }
  if (platform) { params.push(platform); conds.push(`c.platform = $${params.length}`) }
  if (tipo)  { params.push(tipo);  conds.push(`c.tipo = $${params.length}::tipo_nivel`) }
  if (ativo !== undefined) { params.push(ativo); conds.push(`c.ativo = $${params.length}`) }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT
      c.id, c.platform, c.handle, c.tipo, c.ativo, c.criado_em, c.avatar_url AS "avatarUrl",
      c.user_id AS "userId", u.email AS "ownerEmail",
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'id',           t.id,
          'platform',     t.platform,
          'accountName',  t.account_name,
          'accessToken',  t.access_token,
          'expiresAt',    t.expires_at,
          'status',       t.status
        )
      ) FILTER (WHERE t.id IS NOT NULL) AS tokens
    FROM contas c
    LEFT JOIN tokens t ON t.conta_id = c.id
    LEFT JOIN users u ON u.id = c.user_id
    ${where}
    GROUP BY c.id, u.email
    ORDER BY c.tipo, c.criado_em DESC
  `, params)

  // accessToken vem cifrado do banco — decifra e só então trunca pra exibição
  // (truncar o texto cifrado direto no SQL mostraria lixo sem sentido).
  return rows.map(conta => ({
    ...conta,
    tokens: (conta.tokens || []).map(t => {
      const plain = decrypt(t.accessToken)
      return { ...t, accessToken: plain ? plain.slice(0, 12) + '...' : plain }
    })
  }))
}

// ── Criar conta ───────────────────────────────────────────────────────────────
async function criarConta({ platform, handle, tipo, userId }) {
  const { rows } = await pool.query(`
    INSERT INTO contas (platform, handle, tipo, user_id)
    VALUES ($1,$2,$3::tipo_nivel,$4)
    RETURNING *
  `, [platform, handle, tipo, userId])
  return rows[0]
}

// ── Buscar conta por ID ───────────────────────────────────────────────────────
async function buscarContaPorId(id, userId, isAdmin) {
  const { rows: [conta] } = await pool.query(`SELECT * FROM contas WHERE id = $1`, [id])
  if (!conta) return null
  if (!isAdmin && conta.user_id !== userId) return null
  return conta
}

// ── Criar conta rápida (para OAuth flow) ─────────────────────────────────────
// Cada conexão de rede social é sua própria linha em "contas" (platform +
// handle), sem agrupamento por e-mail/nicho. Se o usuário já tem essa mesma
// combinação (mesma plataforma + mesmo handle) conectada, reaproveita a
// linha existente em vez de duplicar.
async function criarContaRapida({ name, platform, userId, avatarUrl = null, externalUserId = null }) {
  if (!['facebook', 'instagram', 'youtube', 'tiktok', 'kwai'].includes(platform)) {
    throw new Error('Plataforma inválida')
  }

  const { rows: [existente] } = await pool.query(
    `SELECT * FROM contas WHERE platform = $1 AND handle = $2 AND user_id = $3 LIMIT 1`,
    [platform, name, userId]
  )
  if (existente) {
    if ((avatarUrl && avatarUrl !== existente.avatar_url) || (externalUserId && externalUserId !== existente.external_user_id)) {
      const { rows: [atualizada] } = await pool.query(
        `UPDATE contas SET avatar_url = COALESCE($1, avatar_url), external_user_id = COALESCE($2, external_user_id) WHERE id = $3 RETURNING *`,
        [avatarUrl, externalUserId, existente.id]
      )
      return atualizada
    }
    return existente
  }

  const { rows: [conta] } = await pool.query(`
    INSERT INTO contas (platform, handle, tipo, user_id, avatar_url, external_user_id)
    VALUES ($1, $2, 'NICHO', $3, $4, $5)
    RETURNING *
  `, [platform, name, userId, avatarUrl, externalUserId])

  return conta
}

// Localiza todas as contas conectadas (de qualquer usuário) cujo ID externo
// na rede social bate com o informado — usado pelo Data Deletion Callback da
// Meta, que identifica o usuário pelo facebook_user_id, não pelo handle.
async function buscarContasPorExternalUserId(platform, externalUserId) {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId" FROM contas WHERE platform = $1 AND external_user_id = $2`,
    [platform, externalUserId]
  )
  return rows
}

// Apaga uma conta conectada e seus tokens (usado pelo Data Deletion Callback —
// remove só a conexão da rede social, não o usuário/cadastro do próprio sistema).
async function apagarDadosDaConta(contaId) {
  await pool.query('DELETE FROM tokens WHERE conta_id = $1', [contaId])
  await pool.query('DELETE FROM contas WHERE id = $1', [contaId])
}

async function deletarConta(id, userId, isAdmin) {
  const conta = await buscarContaPorId(id, userId, isAdmin)
  if (!conta) return false
  await pool.query('DELETE FROM tokens WHERE conta_id = $1', [id])
  const { rowCount } = await pool.query('DELETE FROM contas WHERE id = $1', [id])
  return rowCount > 0
}

// Salva o número de seguidores atual de uma conta do Instagram (1 ponto por
// dia). A API de Insights que daria o histórico direto exige uma permissão
// extra não aprovada pela Meta para este app, então o saldo é construído
// aqui mesmo, a partir de hoje, comparando os snapshots diários acumulados.
async function registrarSnapshotSeguidoresInstagram(contaId, followerCount) {
  await pool.query(`
    INSERT INTO instagram_followers_history (conta_id, captured_on, follower_count)
    VALUES ($1, CURRENT_DATE, $2)
    ON CONFLICT (conta_id, captured_on) DO UPDATE SET follower_count = $2
  `, [contaId, followerCount])
}

// Soma diária de seguidores de todas as contas do Instagram do usuário,
// a partir do dia em que o snapshot começou a ser coletado.
async function buscarHistoricoSeguidoresInstagram(userId, isAdmin) {
  const ownerFilter = isAdmin ? '' : 'AND c.user_id = $1'
  const params = isAdmin ? [] : [userId]

  const { rows } = await pool.query(`
    SELECT h.captured_on AS "date", SUM(h.follower_count)::int AS "followerCount"
    FROM instagram_followers_history h
    JOIN contas c ON c.id = h.conta_id
    WHERE c.platform = 'instagram' ${ownerFilter}
    GROUP BY h.captured_on
    ORDER BY h.captured_on ASC
  `, params)
  return rows
}

// Salva o snapshot diário de seguidores/curtidas totais/vídeos de uma conta
// do TikTok — mesmo padrão do Instagram, já que a API do TikTok também não
// dá histórico retroativo dessas estatísticas.
async function registrarSnapshotStatsTiktok(contaId, { followerCount, likesCount, videoCount }) {
  await pool.query(`
    INSERT INTO tiktok_stats_history (conta_id, captured_on, follower_count, likes_count, video_count)
    VALUES ($1, CURRENT_DATE, $2, $3, $4)
    ON CONFLICT (conta_id, captured_on) DO UPDATE SET follower_count = $2, likes_count = $3, video_count = $4
  `, [contaId, followerCount ?? null, likesCount ?? null, videoCount ?? null])
}

// Soma diária de seguidores/curtidas de todas as contas do TikTok do
// usuário, a partir do dia em que o snapshot começou a ser coletado.
async function buscarHistoricoStatsTiktok(userId, isAdmin) {
  const ownerFilter = isAdmin ? '' : 'AND c.user_id = $1'
  const params = isAdmin ? [] : [userId]

  const { rows } = await pool.query(`
    SELECT h.captured_on AS "date",
           SUM(h.follower_count)::int AS "followerCount",
           SUM(h.likes_count)::int AS "likesCount"
    FROM tiktok_stats_history h
    JOIN contas c ON c.id = h.conta_id
    WHERE c.platform = 'tiktok' ${ownerFilter}
    GROUP BY h.captured_on
    ORDER BY h.captured_on ASC
  `, params)
  return rows
}

module.exports = {
  getDashboardStats, listarContas, criarConta, buscarContaPorId, criarContaRapida, deletarConta,
  buscarContasPorExternalUserId, apagarDadosDaConta,
  registrarSnapshotSeguidoresInstagram, buscarHistoricoSeguidoresInstagram,
  registrarSnapshotStatsTiktok, buscarHistoricoStatsTiktok
}
