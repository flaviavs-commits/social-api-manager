// Orquestra a publicação de um post nas plataformas selecionadas — busca
// token, renova se preciso, chama o adapter da rede e registra o resultado.
// Os adapters de cada rede (chamadas HTTP reais) ficam em ./*Publisher.js.
const pool = require('../../db/pool')
const { registrarLog, broadcastEvent } = require('../../repositories/logsRepository')
const tokensRepo = require('../../repositories/tokensRepository')
const postsRepo = require('../db/postsRepository')
const { decrypt } = require('../../services/tokenCrypto')
const { publicarFacebook } = require('./facebookPublisher')
const { publicarInstagram, statusContainerInstagram, finalizarPublicacaoInstagram } = require('./instagramPublisher')
const { publicarYoutube } = require('./youtubePublisher')
const { publicarTiktok } = require('./tiktokPublisher')

// ── Busca a conta+token conectados para a plataforma ─────────────────────────
// Por padrão, restringe ao dono do post. Super admins podem publicar usando
// qualquer conta conectada no sistema (de qualquer usuário), então para eles
// a busca ignora o dono e pega a mais recente entre todas.
// Se contaId for informado, busca exatamente essa conta (escolhida pelo
// usuário ao agendar o post); senão usa a mais recente conectada na
// plataforma (não há mais agrupamento por estrela/nicho).
async function buscarContaToken(platform, userId, isSuperAdmin = false, contaId = null) {
  const conds = ['t.platform = $1']
  const params = [platform]
  if (!isSuperAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }
  if (contaId) { params.push(contaId); conds.push(`c.id = $${params.length}`) }

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE ${conds.join(' AND ')}
    ORDER BY t.id DESC
    LIMIT 1
  `, params)

  const token = rows[0]
  if (!token) return null
  return { ...token, accessToken: decrypt(token.accessToken), refreshToken: decrypt(token.refreshToken) }
}

// Lista todos os tokens conectados de uma plataforma para o usuário (não só
// o mais recente). Usado para reconciliar posts antigos com o post real na
// rede social, quando ainda não se sabe qual conta publicou cada post.
async function listarContasToken(platform, userId, isSuperAdmin = false) {
  const conds = ['t.platform = $1']
  const params = [platform]
  if (!isSuperAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE ${conds.join(' AND ')}
    ORDER BY t.id DESC
  `, params)

  return rows.map(token => ({ ...token, accessToken: decrypt(token.accessToken), refreshToken: decrypt(token.refreshToken) }))
}

// Extrai o ID do post/mídia na rede social a partir da resposta de cada
// publisher, para permitir buscar métricas (likes/comentários) depois.
// TikTok não retorna um ID público utilizável (a Content Posting API
// devolve só um publish_id interno, assíncrono) — fica sem métricas.
function extrairExternalId(platform, data) {
  if (platform === 'facebook') return data?.id || null
  if (platform === 'instagram') return data?.id || null
  if (platform === 'youtube') return data?.id || null
  // O Content Posting API só devolve um publish_id (identificador da
  // operação de publicação) — não o ID do vídeo em si, que a API não expõe
  // de volta nessa chamada. Serve para rastrear o post via /v2/post/publish/status/fetch/.
  if (platform === 'tiktok') return data?.publish_id || null
  return null
}

const PUBLISHERS = {
  facebook: publicarFacebook,
  instagram: publicarInstagram,
  youtube: publicarYoutube,
  tiktok: publicarTiktok
}

// Publica em uma única plataforma e retorna o resultado (registrando o log
// correspondente) — extraído para permitir publicar em todas as plataformas
// do post em paralelo, em vez de uma por vez.
async function publicarNaPlataforma(platform, post, isSuperAdmin) {
  const publisher = PUBLISHERS[platform]
  if (!publisher) {
    return { platform, success: false, error: `Plataforma "${platform}" não suportada` }
  }

  let token = await buscarContaToken(platform, post.userId, isSuperAdmin, post.accountId)
  if (!token) {
    const msg = `Nenhuma conta de ${platform} conectada`
    await registrarLog({ type: 'err', message: `Publicação falhou [${platform}]: ${msg}`, platform, user_id: post.userId })
    return { platform, success: false, error: msg }
  }

  // ── Renovação automática do token antes de publicar, se necessário ──
  // Chamada interna do scheduler (sem requisição HTTP/usuário autenticado),
  // então passa isAdmin=true para não exigir a checagem de propriedade do
  // token que só faz sentido quando um usuário pede a renovação pela API.
  if (token.status !== 'valid') {
    const renewal = await tokensRepo.renovarToken(token.token_id, null, true)
    if (renewal.success) {
      token = await buscarContaToken(platform, post.userId, isSuperAdmin, post.accountId)
    } else {
      await registrarLog({
        type: 'err',
        message: `Token expirado para "${token.handle || token.accountName}" no ${platform} — não foi possível renovar automaticamente: ${renewal.message}`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
      return { platform, success: false, account: token.handle || token.accountName, error: renewal.message }
    }
  }

  try {
    const data = await publisher(token, post)

    // Instagram: o container foi criado, mas ainda precisa terminar de
    // processar antes de poder ser publicado de fato — isso é confirmado
    // depois, via finalizarInstagramPendentes() (chamada pelo cron), não
    // bloqueando esta requisição/invocação à espera do Instagram.
    if (data?.pending) {
      await postsRepo.salvarInstagramPending(post.id, { ...data, tokenId: token.token_id, accessToken: token.accessToken, accountName: token.handle || token.accountName, contaId: token.contaId })
      const tipoPost = data.stage === 'carousel_children' ? 'Carrossel' : 'Post'
      await registrarLog({
        type: 'info',
        message: `${tipoPost} enviado para o Instagram na conta "${token.handle || token.accountName}" — aguardando processamento (pode levar até 1 min)`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
      return { platform, success: 'pending', account: token.handle || token.accountName, data }
    }

    const externalId = extrairExternalId(platform, data)
    if (externalId) {
      await postsRepo.salvarPublicacaoExterna(post.id, {
        externalPostId: externalId,
        externalPlatform: platform,
        publishedAt: new Date().toISOString()
      })
    }

    if (data?.simulado) {
      await registrarLog({
        type: 'warn',
        message: `Publicação simulada [${platform}] na conta "${token.handle || token.accountName}" — ${data.mensagem || 'não foi postado de fato'}`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
    } else {
      // TikTok não retorna o ID público do vídeo nem o share_url no momento
      // do publish (só o publish_id, usado pra consultar o status depois) —
      // por isso vai no log para facilitar achar o post sem precisar abrir o
      // app do TikTok manualmente.
      const detalheTiktok = platform === 'tiktok' && data?.publish_id ? ` (publish_id: ${data.publish_id})` : ''
      const platLabel = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }[platform] || platform
      await registrarLog({
        type: 'ok',
        message: `Post publicado no ${platLabel} na conta "${token.handle || token.accountName}" com sucesso! ✓${detalheTiktok}`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
    }

    return { platform, success: true, account: token.handle || token.accountName, data }
  } catch (err) {
    await registrarLog({
      type: 'err',
      message: `Não foi possível publicar no ${platform} na conta "${token.handle || token.accountName}": ${err.message}`,
      platform,
      conta_id: token.contaId,
      user_id: post.userId
    })
    return { platform, success: false, account: token.handle || token.accountName, error: err.message }
  }
}

// ── Publica um post (já salvo no banco) em todas as suas plataformas ─────────────
// As plataformas são independentes entre si (contas/tokens/APIs distintas), então
// publicar em paralelo reduz o tempo total da soma dos tempos para o máximo entre elas.
async function publishPost(post) {
  const isSuperAdmin = post.userRole === 'super_admin'
  return Promise.all(post.platforms.map(platform => publicarNaPlataforma(platform, post, isSuperAdmin)))
}

// Verifica, uma vez por post, se o(s) container(s) pendentes do Instagram já
// terminaram de processar — e se sim, publica de fato e atualiza o status do
// post. Chamada pelo cron (mesmo tick de processarPendentes), substituindo o
// polling bloqueante que existia antes dentro da própria publicação.
async function finalizarInstagramPendentes() {
  const pendentes = await postsRepo.listarPostsComInstagramPendente()

  await Promise.all(pendentes.map(async post => {
    const pending = post.instagramPending
    try {
      const containerIds = pending.stage === 'carousel_children' ? pending.childIds : [pending.containerId]
      const statuses = await Promise.all(containerIds.map(id => statusContainerInstagram(id, pending.accessToken)))

      if (statuses.some(s => s === 'ERROR')) throw new Error('O Instagram encontrou um problema ao processar a mídia. Verifique se o arquivo é válido e tente publicar novamente.')
      if (!statuses.every(s => s === 'FINISHED')) return // ainda processando — tenta de novo no próximo tick

      const data = await finalizarPublicacaoInstagram(pending)

      // Container pai do carrossel ainda não estava pronto — atualiza o pending e tenta no próximo tick
      if (data?.requeue) {
        await postsRepo.salvarInstagramPending(post.id, { ...pending, stage: 'carousel_container', containerId: data.containerId })
        return
      }

      const externalId = extrairExternalId('instagram', data)
      if (externalId) {
        await postsRepo.salvarPublicacaoExterna(post.id, { externalPostId: externalId, externalPlatform: 'instagram', publishedAt: new Date().toISOString() })
      }
      await postsRepo.limparInstagramPending(post.id)
      await postsRepo.atualizarStatusPost(post.id, 'published')

      const tipoMidia = pending.stage === 'carousel_children' || pending.stage === 'carousel_container' ? 'Carrossel' : 'Post'
      await registrarLog({ type: 'ok', message: `${tipoMidia} publicado no Instagram na conta "${pending.accountName}" com sucesso! ✓`, platform: 'instagram', conta_id: pending.contaId, user_id: post.userId })
      broadcastEvent('post_published', { id: post.id, status: 'published', platforms: post.platforms, text: post.text, results: [{ platform: 'instagram', success: true, data }] }, post.userId)
    } catch (err) {
      await postsRepo.limparInstagramPending(post.id)
      await postsRepo.atualizarStatusPost(post.id, 'error')
      await registrarLog({ type: 'err', message: `Não foi possível publicar no Instagram na conta "${pending.accountName}": ${err.message}`, platform: 'instagram', conta_id: pending.contaId, user_id: post.userId })
      broadcastEvent('post_published', { id: post.id, status: 'error', platforms: post.platforms, text: post.text, results: [{ platform: 'instagram', success: false, error: err.message }] }, post.userId)
    }
  }))
}

module.exports = { publishPost, buscarContaToken, listarContasToken, finalizarInstagramPendentes }
