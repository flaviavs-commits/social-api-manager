// Orquestra a publicação de um post nas plataformas selecionadas — busca
// token, renova se preciso, chama o adapter da rede e registra o resultado.
// Os adapters de cada rede (chamadas HTTP reais) ficam em ./*Publisher.js.
const pool = require('../../db/pool')
const { registrarLog, broadcastEvent } = require('../../repositories/logsRepository')
const tokensRepo = require('../../repositories/tokensRepository')
const postsRepo = require('../db/postsRepository')
const { decrypt } = require('../../services/tokenCrypto')
const { statusContainerInstagram, finalizarPublicacaoInstagram } = require('./instagramPublisher')
const { publicarZernioInstagram, publicarZernioFacebook, publicarZernioYoutube, publicarZernioTiktok } = require('./zernioPublisher')
const zernioClient = require('./zernioClient')
const { publicarYoutube } = require('./youtubePublisher')
const { mapWithConcurrency } = require('../../utils/concurrency')

const PUBLICATION_CONCURRENCY = 4

// ── Busca a conta+token de uma conta específica ──────────────────────────────
// Sempre restringe ao dono do post quando userId é informado. contaId é sempre
// obrigatório no fluxo atual — a resolução de "quais contas usar" já
// aconteceu antes, em criarPost.js (ver migrations/027_post_accounts.sql);
// não há fallback para "a mais recente conectada" nem atalho por papel.
async function buscarContaToken(platform, userId, isSuperAdmin = false, contaId = null) {
  const conds = ['t.platform = $1']
  const params = [platform]
  if (userId !== null && userId !== undefined) {
    params.push(userId)
    conds.push(`c.user_id = $${params.length}`)
  } else if (!isSuperAdmin) conds.push('FALSE')
  if (contaId) { params.push(contaId); conds.push(`c.id = $${params.length}`) }

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle, c.external_user_id AS "externalUserId",
      c.zernio_account_id AS "zernioAccountId"
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

async function buscarTokenPorId(tokenId, userId, isSuperAdmin = false) {
  const params = [tokenId]
  const hasUserScope = userId !== null && userId !== undefined
  const owner = hasUserScope ? ' AND c.user_id = $2' : (isSuperAdmin ? '' : ' AND FALSE')
  if (hasUserScope) params.push(userId)
  const { rows } = await pool.query(`
    SELECT t.id AS token_id, t.conta_id AS "contaId", t.access_token AS "accessToken",
           t.refresh_token AS "refreshToken", t.account_name AS "accountName",
           t.status, t.expires_at AS "expiresAt", c.handle AS handle,
           c.external_user_id AS "externalUserId", c.zernio_account_id AS "zernioAccountId"
    FROM tokens t
    JOIN contas c ON c.id = t.conta_id
    WHERE t.id = $1${owner}
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
  if (userId !== null && userId !== undefined) {
    params.push(userId)
    conds.push(`c.user_id = $${params.length}`)
  } else if (!isSuperAdmin) conds.push('FALSE')

  const { rows } = await pool.query(`
    SELECT
      t.id AS token_id, t.conta_id AS "contaId", t.platform, t.access_token AS "accessToken",
      t.refresh_token AS "refreshToken", t.account_name AS "accountName",
      t.status, t.expires_at AS "expiresAt", c.handle AS handle, c.zernio_account_id AS "zernioAccountId"
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
  // Facebook/Instagram/TikTok publicam via Zernio — data.platformPostId é o
  // ID do post NA REDE SOCIAL (extraído por zernioPublisher.js de dentro de
  // platforms[]), não data._id (que é só o ID do post no Zernio). GET
  // /v1/analytics indexa métricas por platformPostId — salvar o outro ID
  // aqui deixaria toda métrica por-post null para sempre.
  if (platform === 'facebook') return data?.platformPostId || null
  if (platform === 'instagram') return data?.platformPostId || null
  if (platform === 'tiktok') return data?.platformPostId || null
  if (platform === 'youtube') return data?.id || null
  return null
}

// Facebook/Instagram/TikTok/YouTube publicam via Zernio agora (docs.zernio.com) —
// ver src/infra/social/zernioPublisher.js e src/routes/oauth.js
// (syncZernioAccount). A função do YouTube mantém fallback para contas antigas
// conectadas diretamente ao Google.
async function publicarYoutubePorProvedor(token, post, options = {}) {
  return token.zernioAccountId ? publicarZernioYoutube(token, post, options) : publicarYoutube(token, post)
}

const PUBLISHERS = {
  facebook: publicarZernioFacebook,
  instagram: publicarZernioInstagram,
  youtube: publicarYoutubePorProvedor,
  tiktok: publicarZernioTiktok
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

function existingZernioPostId(err) {
  if (err?.name !== 'ZernioError' || err.status !== 409) return null
  // Resposta documentada: { error, details: { existingPostId } }.
  return err.details?.details?.existingPostId || err.details?.existingPostId || null
}

// Um POST pode ter sido aceito pelo Zernio e a resposta se perder antes de
// chegar aqui. A nova tentativa recebe 409, mas isso é uma confirmação
// indireta, não uma falha. Consulta o post existente e reaproveita o contrato
// normal do publisher.
async function reconciliarDuplicidadeZernio({ platform, existingPostId }) {
  const response = await zernioClient.getPost(existingPostId)
  const zernioPost = response?.post || response
  const entry = zernioPost?.platforms?.find(item => item.platform === platform)
  if (!entry) throw new Error(`O Zernio não retornou a plataforma ${platform} para a publicação duplicada.`)

  if (entry.status === 'failed' || zernioPost?.status === 'failed') {
    throw new Error(entry.errorMessage || 'A publicação existente no Zernio falhou.')
  }

  if (!entry.platformPostId) {
    return {
      pending: true,
      provider: 'zernio',
      reconciled: true,
      zernioPostId: zernioPost._id || existingPostId,
      platform
    }
  }

  return {
    ...zernioPost,
    provider: 'zernio',
    reconciled: true,
    platformPostId: entry.platformPostId,
    platformPostUrl: entry.platformPostUrl || null
  }
}

// Publica em uma única conta e retorna o resultado (registrando o log
// correspondente) — extraído para permitir publicar em todas as contas do
// post em paralelo, em vez de uma por vez. `account` já vem resolvido (ver
// criarPost.js): { postAccountId, accountId, platform, handle, mediaItems }.
async function publicarNaConta(account, post, isSuperAdmin) {
  const platform = account.platform
  await postsRepo.atualizarErroPublicacaoConta(account.postAccountId, null)
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
    const error = `Plataforma "${platform}" não suportada`
    await postsRepo.atualizarErroPublicacaoConta(account.postAccountId, error)
    return { platform, accountId: account.accountId, success: false, error }
  }

  let token = await buscarContaToken(platform, post.userId, isSuperAdmin, account.accountId)
  if (!token) {
    const msg = `Conta de ${platform} não encontrada ou desconectada`
    await postsRepo.atualizarErroPublicacaoConta(account.postAccountId, msg)
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
      await postsRepo.atualizarErroPublicacaoConta(account.postAccountId, renewal.message)
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
    // O identificador é persistido antes da chamada externa e reutilizado por
    // retries, deploys e instâncias concorrentes do scheduler.
    const providerRequestId = await postsRepo.obterProviderRequestId(account.postAccountId)
    let data
    try {
      data = await publisher(token, post, { requestId: providerRequestId })
    } catch (err) {
      const duplicateId = existingZernioPostId(err)
      if (!duplicateId) throw err
      data = await reconciliarDuplicidadeZernio({ platform, existingPostId: duplicateId })
    }

    // Instagram (fluxo direto, não migrado): o container foi criado, mas
    // ainda precisa terminar de processar antes de poder ser publicado de
    // fato — confirmado depois via finalizarInstagramPendentes() (cron).
    // Facebook/Instagram/TikTok via Zernio: publishNow:true não é síncrono
    // apesar do nome — o post pode continuar "processing" no lado deles por
    // segundos/minutos (confirmado em teste real, mais comum com vídeo no
    // TikTok) sem devolver o platformPostId ainda; confirmado depois via
    // finalizarZernioPendentes() (cron). Os dois casos usam o mesmo
    // contrato (data.pending) e a mesma coluna post_accounts.instagram_pending
    // como espaço de estado — o nome da coluna ficou datado, mas reaproveitar
    // evita uma migration só para isso; o campo "provider" dentro do JSON
    // diferencia qual finalizador (cron) deve tratar cada linha.
    if (data?.pending) {
      await postsRepo.atualizarErroPublicacaoConta(account.postAccountId, null)
      const isZernio = data.provider === 'zernio'
      await postsRepo.salvarInstagramPending(account.postAccountId, { ...data, tokenId: token.token_id, accountName: token.handle || token.accountName, contaId: token.contaId, criadoEm: new Date().toISOString() })
      const platLabel = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }[platform] || platform
      const tipoPost = data.stage === 'carousel_children' ? 'Carrossel' : 'Post'
      await registrarLog({
        type: 'info',
        message: isZernio
          ? `${tipoPost} enviado para o ${platLabel} na conta "${token.handle || token.accountName}" — aguardando confirmação do Zernio (pode levar alguns minutos)`
          : `${tipoPost} enviado para o Instagram na conta "${token.handle || token.accountName}" — aguardando processamento (pode levar até 1 min)`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
      return { platform, accountId: account.accountId, success: 'pending', account: token.handle || token.accountName, data }
    }

    const externalId = extrairExternalId(platform, data)
    await postsRepo.atualizarErroPublicacaoConta(account.postAccountId, null)
    if (externalId) {
      await postsRepo.salvarPublicacaoExterna(post.id, {
        externalPostId: externalId,
        externalPlatform: platform,
        publishedAt: new Date().toISOString(),
        accountId: account.accountId,
        firstCommentHandled: data?.provider === 'zernio'
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
        message: `Post publicado no ${platLabel} na conta "${token.handle || token.accountName}" com sucesso! ✓${data?.reconciled ? ' (confirmação recuperada após retry)' : ''}${detalheTiktok}`,
        platform,
        conta_id: token.contaId,
        user_id: post.userId
      })
    }

    return { platform, accountId: account.accountId, success: true, account: token.handle || token.accountName, data }
  } catch (err) {
    await postsRepo.atualizarErroPublicacaoConta(account.postAccountId, err.message)
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
  return mapWithConcurrency(accounts, account => publicarNaConta(account, post, isSuperAdmin), PUBLICATION_CONCURRENCY)
}

// Verifica, por (post, conta), se o(s) container(s) pendentes do Instagram já
// terminaram de processar — e se sim, publica de fato. Chamada pelo cron
// (mesmo tick de processarPendentes), substituindo o polling bloqueante que
// existia antes dentro da própria publicação.
//
// post_accounts.instagram_pending também guarda pendências do Zernio agora
// (ver publicarNaConta) — cada linha tem data.provider === 'zernio' quando
// veio de lá, e este loop as ignora (finalizarZernioPendentes trata essas).
//
// O status final do post só é decidido quando NENHUMA conta do post (de
// nenhuma rede) ainda estiver pendente — antes disso, uma falha real de
// outra rede publicada no mesmo ciclo seria perdida se fechássemos o status
// olhando só o Instagram. Os resultados das demais contas já publicadas são
// reconstruídos a partir de post_publications (sucesso) — contas que não
// aparecem lá e não estão mais pendentes são tratadas como falha.
async function finalizarInstagramPendentes() {
  const pendentes = (await postsRepo.listarPostsComInstagramPendente())
    .filter(linha => linha.instagramPending.provider !== 'zernio')

  await Promise.all(pendentes.map(async linha => {
    const pending = linha.instagramPending
    const postId = linha.id
    try {
      const token = await buscarTokenPorId(pending.tokenId, linha.userId, linha.userRole === 'super_admin')
      if (!token) throw new Error('Token da conta não encontrado ou desconectado')
      const containerIds = pending.stage === 'carousel_children' ? pending.childIds : [pending.containerId]
      const statuses = await Promise.all(containerIds.map(id => statusContainerInstagram(id, token.accessToken)))

      if (statuses.some(s => s === 'ERROR')) throw new Error('O Instagram encontrou um problema ao processar a mídia. Verifique se o arquivo é válido e tente publicar novamente.')
      if (!statuses.every(s => s === 'FINISHED')) return // ainda processando — tenta de novo no próximo tick

      const data = await finalizarPublicacaoInstagram({ ...pending, accessToken: token.accessToken })

      // Container pai do carrossel ainda não estava pronto — atualiza o pending e tenta no próximo tick
      if (data?.requeue) {
        await postsRepo.salvarInstagramPending(linha.postAccountId, { ...pending, stage: 'carousel_container', containerId: data.containerId })
        return
      }

      const externalId = extrairExternalId('instagram', data)
      if (externalId) {
        await postsRepo.salvarPublicacaoExterna(postId, { externalPostId: externalId, externalPlatform: 'instagram', publishedAt: new Date().toISOString(), accountId: linha.accountId })
      }
      await postsRepo.atualizarErroPublicacaoConta(linha.postAccountId, null)
      await postsRepo.limparInstagramPending(linha.postAccountId)

      const tipoMidia = pending.stage === 'carousel_children' || pending.stage === 'carousel_container' ? 'Carrossel' : 'Post'
      await registrarLog({ type: 'ok', message: `${tipoMidia} publicado no Instagram na conta "${pending.accountName}" com sucesso! ✓`, platform: 'instagram', conta_id: pending.contaId, user_id: linha.userId })
      await fecharStatusSeSemPendencias(postId, linha)
    } catch (err) {
      await postsRepo.atualizarErroPublicacaoConta(linha.postAccountId, err.message)
      await postsRepo.limparInstagramPending(linha.postAccountId)
      await registrarLog({ type: 'err', message: `Não foi possível publicar no Instagram na conta "${pending.accountName}": ${err.message}`, platform: 'instagram', conta_id: pending.contaId, user_id: linha.userId })
      await fecharStatusSeSemPendencias(postId, linha)
    }
  }))
}

// Timeout de segurança: se o Zernio nunca terminar de processar um post
// (falha silenciosa do lado deles, vídeo corrompido que trava para sempre
// etc.), a pendência não pode ficar presa indefinidamente — depois desse
// tempo, desiste e marca como falha em vez de reter o post como
// "processing" para sempre.
const ZERNIO_PENDING_TIMEOUT_MS = 15 * 60 * 1000

// Equivalente a finalizarInstagramPendentes(), mas para posts publicados
// via Zernio (Facebook/Instagram/TikTok/YouTube) cujo platformPostId não veio na
// resposta imediata do createPost — ver zernioPublisher.js/
// extrairDadosDaPlataforma. Consulta GET /v1/posts/{id} de novo a cada
// tick do cron até status virar "published" (extrai o platformPostId real)
// ou "failed"/timeout (desiste).
async function finalizarZernioPendentes() {
  const pendentes = (await postsRepo.listarPostsComInstagramPendente())
    .filter(linha => linha.instagramPending.provider === 'zernio')

  await Promise.all(pendentes.map(async linha => {
    const pending = linha.instagramPending
    const postId = linha.id
    const platform = pending.platform
    try {
      const { post: zernioPost } = await zernioClient.getPost(pending.zernioPostId)
      const entrada = zernioPost?.platforms?.find(p => p.platform === platform)

      if (entrada?.status === 'failed' || zernioPost?.status === 'failed') {
        throw new Error(entrada?.errorMessage || 'O Zernio não conseguiu publicar o post.')
      }

      if (!entrada?.platformPostId) {
        // Ainda processando — tenta de novo no próximo tick, a menos que já
        // tenha estourado o timeout de segurança.
        const iniciadoEm = new Date(pending.criadoEm || linha.criado_em || Date.now()).getTime()
        if (Date.now() - iniciadoEm > ZERNIO_PENDING_TIMEOUT_MS) {
          throw new Error('Tempo esgotado aguardando confirmação do Zernio.')
        }
        return
      }

      const externalId = entrada.platformPostId
      await postsRepo.salvarPublicacaoExterna(postId, {
        externalPostId: externalId,
        externalPlatform: platform,
        publishedAt: new Date().toISOString(),
        accountId: linha.accountId,
        firstCommentHandled: true
      })
      await postsRepo.atualizarErroPublicacaoConta(linha.postAccountId, null)
      await postsRepo.limparInstagramPending(linha.postAccountId)

      const platLabel = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }[platform] || platform
      await registrarLog({ type: 'ok', message: `Post publicado no ${platLabel} na conta "${pending.accountName}" com sucesso! ✓`, platform, conta_id: pending.contaId, user_id: linha.userId })
      await fecharStatusSeSemPendencias(postId, linha)
    } catch (err) {
      await postsRepo.atualizarErroPublicacaoConta(linha.postAccountId, err.message)
      await postsRepo.limparInstagramPending(linha.postAccountId)
      const platLabel = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' }[platform] || platform
      await registrarLog({ type: 'err', message: `Não foi possível publicar no ${platLabel} na conta "${pending.accountName}": ${err.message}`, platform, conta_id: pending.contaId, user_id: linha.userId })
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
      account: c.handle || undefined,
      success: publicadasSet.has(`${c.platform}:${c.accountId}`),
      ...(c.publicationError ? { error: c.publicationError } : {})
  }))

  const status = results.every(r => r.success) ? 'published'
    : results.some(r => r.success) ? 'partial'
    : 'error'

  const failureDetails = results
    .filter(result => result.success === false)
    .map(result => `${result.platform || 'Rede social'}${result.account ? ` (${result.account})` : ''}: ${result.error || 'A rede não informou o motivo.'}`)
    .join(' | ') || null
  await postsRepo.atualizarStatusPost(postId, status, status === 'published' ? null : failureDetails)
  broadcastEvent('post_published', { id: postId, status, platforms: linha.platforms, text: linha.text, results }, linha.userId)
}

module.exports = { publishPost, buscarContaToken, listarContasToken, finalizarInstagramPendentes, finalizarZernioPendentes }
