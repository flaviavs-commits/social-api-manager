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
const { publicarThreads } = require('./threadsPublisher')
const { publicarLinkedin } = require('./linkedinPublisher')
const { publicarPinterest } = require('./pinterestPublisher')

// ── Busca a conta+token de uma conta específica ──────────────────────────────
// Por padrão, restringe ao dono do post. Super admins podem publicar usando
// qualquer conta conectada no sistema (de qualquer usuário). contaId é sempre
// obrigatório no fluxo atual — a resolução de "quais contas usar" já
// aconteceu antes, em criarPost.js (ver migrations/027_post_accounts.sql);
// não há mais fallback para "a mais recente conectada".
async function buscarContaToken(platform, userId, isSuperAdmin = false, contaId = null) {
  const conds = ['t.platform = $1']
  const params = [platform]
  if (!isSuperAdmin) { params.push(userId); conds.push(`c.user_id = $${params.length}`) }
  if (contaId) { params.push(contaId); conds.push(`c.id = $${params.length}`) }

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle, c.external_user_id AS "externalUserId"
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
  if (platform === 'threads') return data?.id || null
  if (platform === 'linkedin') return data?.id || null
  if (platform === 'pinterest') return data?.id || null
  return null
}

const PUBLISHERS = {
  facebook: publicarFacebook,
  instagram: publicarInstagram,
  youtube: publicarYoutube,
  tiktok: publicarTiktok,
  threads: publicarThreads,
  linkedin: publicarLinkedin,
  pinterest: publicarPinterest
}

// Distingue falha transitória (vale tentar de novo mais tarde: 5xx, rate
// limit, timeout de rede) de falha permanente (4xx de configuração/conteúdo,
// token inválido — repetir não muda o resultado). Os publishers de cada rede
// não expõem o status HTTP estruturado no Error (ver facebookPublisher.js,
// instagramPublisher.js etc.) — só na mensagem, no formato "X respondeu N"
// como fallback quando a API não devolve um error.message legível. Por
// segurança, o padrão é tratar como PERMANENTE quando não há sinal claro de
// transitoriedade (evita retry infinito em erro real de configuração).
function isErroTransitorio(err) {
  const msg = (err?.message || '').toLowerCase()
  if (/respondeu (429|500|502|503|504)/.test(msg)) return true
  if (/rate limit|too many requests|timeout|econnreset|etimedout|enotfound|fetch failed/.test(msg)) return true
  return false
}

// Publica em uma única conta e retorna o resultado (registrando o log
// correspondente) — extraído para permitir publicar em todas as contas do
// post em paralelo, em vez de uma por vez. `account` já vem resolvido (ver
// criarPost.js): { postAccountId, accountId, platform, handle, mediaItems }.
async function publicarNaConta(account, post, isSuperAdmin) {
  const platform = account.platform
  // Texto diferente por rede (Agendador manual, seletor de abas) — opcional,
  // cai no texto principal (post.text) quando a rede não tem entrada própria
  // em text_by_platform. Quando a rede tem 2+ contas marcadas no mesmo post
  // (ex.: 2 perfis de Instagram), o front grava 1 entrada por conta, com
  // chave "<rede>:<idDaConta>" — tentada primeiro, antes da chave só por
  // rede (compatível com posts antigos/de 1 conta só). Ver domain/posts/post.js,
  // migrations/029 e o front (getCustomizationUnits()).
  const chaveConta = `${platform}:${account.accountId}`
  const textoResolvido = post.textByPlatform?.[chaveConta] ?? post.textByPlatform?.[platform] ?? post.text
  // Título diferente por rede — opcional, cai no título principal do YouTube
  // (post.youtubeTitle) quando a rede não tem entrada própria em
  // title_by_platform. Ver domain/posts/post.js e migrations/032.
  const tituloResolvido = post.titleByPlatform?.[chaveConta] ?? post.titleByPlatform?.[platform] ?? post.youtubeTitle
  post = { ...post, text: textoResolvido, youtubeTitle: tituloResolvido }

  // Mídia independente por rede — opcional, cai na mídia compartilhada do
  // post (post.mediaPath/mediaType/mediaItems) quando a conta não tem
  // media_items própria em post_accounts. Ver migrations/035. Isso garante
  // que posts antigos e o cron em voo durante o deploy continuem publicando
  // exatamente como antes desta coluna existir.
  if (account.mediaItems?.length) {
    const primeiro = account.mediaItems[0]
    post = {
      ...post,
      mediaItems: account.mediaItems.length > 1 ? account.mediaItems : null,
      mediaPath: primeiro.path,
      mediaType: primeiro.type
    }
  }

  const publisher = PUBLISHERS[platform]
  if (!publisher) {
    return { platform, accountId: account.accountId, success: false, error: `Plataforma "${platform}" não suportada` }
  }

  let token = await buscarContaToken(platform, post.userId, isSuperAdmin, account.accountId)
  if (!token) {
    const msg = `Conta de ${platform} não encontrada ou desconectada`
    await registrarLog({ type: 'err', message: `Publicação falhou [${platform}]: ${msg}`, platform, user_id: post.userId })
    return { platform, accountId: account.accountId, success: false, error: msg }
  }

  // ── Renovação automática do token antes de publicar, se necessário ──
  // Chamada interna do scheduler (sem requisição HTTP/usuário autenticado),
  // então passa isAdmin=true para não exigir a checagem de propriedade do
  // token que só faz sentido quando um usuário pede a renovação pela API.
  if (token.status !== 'valid') {
    const renewal = await tokensRepo.renovarToken(token.token_id, null, true)
    if (renewal.success) {
      token = await buscarContaToken(platform, post.userId, isSuperAdmin, account.accountId)
    } else {
      await registrarLog({
        type: 'err',
        message: `Token expirado para "${token.handle || token.accountName}" no ${platform} — não foi possível renovar automaticamente: ${renewal.message}`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
      return { platform, accountId: account.accountId, success: false, account: token.handle || token.accountName, error: renewal.message }
    }
  }

  try {
    const data = await publisher(token, post)

    // Instagram: o container foi criado, mas ainda precisa terminar de
    // processar antes de poder ser publicado de fato — isso é confirmado
    // depois, via finalizarInstagramPendentes() (chamada pelo cron), não
    // bloqueando esta requisição/invocação à espera do Instagram. A
    // pendência é por (post, conta) — post_accounts.id — para suportar
    // múltiplas contas de Instagram publicando o mesmo post em paralelo.
    if (data?.pending) {
      await postsRepo.salvarInstagramPending(account.postAccountId, { ...data, tokenId: token.token_id, accessToken: token.accessToken, accountName: token.handle || token.accountName, contaId: token.contaId })
      const tipoPost = data.stage === 'carousel_children' ? 'Carrossel' : 'Post'
      await registrarLog({
        type: 'info',
        message: `${tipoPost} enviado para o Instagram na conta "${token.handle || token.accountName}" — aguardando processamento (pode levar até 1 min)`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
      return { platform, accountId: account.accountId, success: 'pending', account: token.handle || token.accountName, data }
    }

    const externalId = extrairExternalId(platform, data)
    if (externalId) {
      await postsRepo.salvarPublicacaoExterna(post.id, {
        externalPostId: externalId,
        externalPlatform: platform,
        publishedAt: new Date().toISOString(),
        accountId: account.accountId
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

    return { platform, accountId: account.accountId, success: true, account: token.handle || token.accountName, data }
  } catch (err) {
    await registrarLog({
      type: 'err',
      message: `Não foi possível publicar no ${platform} na conta "${token.handle || token.accountName}": ${err.message}`,
      platform,
      conta_id: token.contaId,
      user_id: post.userId
    })
    return { platform, accountId: account.accountId, success: false, account: token.handle || token.accountName, error: err.message, transient: isErroTransitorio(err) }
  }
}

// ── Publica um post (já salvo no banco) em todas as suas contas ──────────────
// post.accounts vem de postsRepo.listarContasDoPost/reservarPostsPendentes —
// uma entrada por conta selecionada (pode haver várias da mesma rede, ex.: 2
// perfis de Instagram). Contas são independentes entre si, então publicar em
// paralelo reduz o tempo total da soma dos tempos para o máximo entre elas.
async function publishPost(post) {
  const isSuperAdmin = post.userRole === 'super_admin'
  const accounts = post.accounts || []
  return Promise.all(accounts.map(account => publicarNaConta(account, post, isSuperAdmin)))
}

// Verifica, por (post, conta), se o(s) container(s) pendentes do Instagram já
// terminaram de processar — e se sim, publica de fato. Chamada pelo cron
// (mesmo tick de processarPendentes), substituindo o polling bloqueante que
// existia antes dentro da própria publicação.
//
// O status final do post só é decidido quando NENHUMA conta do post (de
// nenhuma rede) ainda estiver pendente — antes disso, uma falha real de
// outra rede publicada no mesmo ciclo seria perdida se fechássemos o status
// olhando só o Instagram. Os resultados das demais contas já publicadas são
// reconstruídos a partir de post_publications (sucesso) — contas que não
// aparecem lá e não estão mais pendentes são tratadas como falha.
async function finalizarInstagramPendentes() {
  const pendentes = await postsRepo.listarPostsComInstagramPendente()

  await Promise.all(pendentes.map(async linha => {
    const pending = linha.instagramPending
    const postId = linha.id
    try {
      const containerIds = pending.stage === 'carousel_children' ? pending.childIds : [pending.containerId]
      const statuses = await Promise.all(containerIds.map(id => statusContainerInstagram(id, pending.accessToken)))

      if (statuses.some(s => s === 'ERROR')) throw new Error('O Instagram encontrou um problema ao processar a mídia. Verifique se o arquivo é válido e tente publicar novamente.')
      if (!statuses.every(s => s === 'FINISHED')) return // ainda processando — tenta de novo no próximo tick

      const data = await finalizarPublicacaoInstagram(pending)

      // Container pai do carrossel ainda não estava pronto — atualiza o pending e tenta no próximo tick
      if (data?.requeue) {
        await postsRepo.salvarInstagramPending(linha.postAccountId, { ...pending, stage: 'carousel_container', containerId: data.containerId })
        return
      }

      const externalId = extrairExternalId('instagram', data)
      if (externalId) {
        await postsRepo.salvarPublicacaoExterna(postId, { externalPostId: externalId, externalPlatform: 'instagram', publishedAt: new Date().toISOString(), accountId: linha.accountId })
      }
      await postsRepo.limparInstagramPending(linha.postAccountId)

      const tipoMidia = pending.stage === 'carousel_children' || pending.stage === 'carousel_container' ? 'Carrossel' : 'Post'
      await registrarLog({ type: 'ok', message: `${tipoMidia} publicado no Instagram na conta "${pending.accountName}" com sucesso! ✓`, platform: 'instagram', conta_id: pending.contaId, user_id: linha.userId })
      await fecharStatusSeSemPendencias(postId, linha)
    } catch (err) {
      await postsRepo.limparInstagramPending(linha.postAccountId)
      await registrarLog({ type: 'err', message: `Não foi possível publicar no Instagram na conta "${pending.accountName}": ${err.message}`, platform: 'instagram', conta_id: pending.contaId, user_id: linha.userId })
      await fecharStatusSeSemPendencias(postId, linha)
    }
  }))
}

// Recompõe e grava o status final do post (published/partial/error) a partir
// de TODAS as suas contas, não só do Instagram — só roda quando não sobra
// nenhuma pendência para este post_id (pode haver mais de uma conta de
// Instagram pendente no mesmo post).
async function fecharStatusSeSemPendencias(postId, linha) {
  const aindaPendente = await postsRepo.existePendenciaInstagramNoPost(postId)
  if (aindaPendente) return

  const contas = await postsRepo.listarContasDoPost(postId)
  const publicadas = await postsRepo.listarPublicacoesDosPosts([postId])
  const publicadasSet = new Set(publicadas.map(p => `${p.platform}:${p.accountId}`))

  const results = contas.map(c => ({
    platform: c.platform,
    accountId: c.accountId,
    success: publicadasSet.has(`${c.platform}:${c.accountId}`)
  }))

  const status = results.every(r => r.success) ? 'published'
    : results.some(r => r.success) ? 'partial'
    : 'error'

  await postsRepo.atualizarStatusPost(postId, status)
  broadcastEvent('post_published', { id: postId, status, platforms: linha.platforms, text: linha.text, results }, linha.userId)
}

module.exports = { publishPost, buscarContaToken, listarContasToken, finalizarInstagramPendentes }
