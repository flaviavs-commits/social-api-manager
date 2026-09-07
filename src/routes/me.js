const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { createRateLimitStore } = require('../infra/http/postgresRateLimitStore')
const bcrypt = require('bcrypt')
const QRCode = require('qrcode')
const usersRepo = require('../repositories/usersRepository')
const credentialsRepo = require('../repositories/credentialsRepository')
const { serverError, validarComplexidadeSenha } = require('../utils/http')
const { addLog } = require('../middleware/logger')
const totp = require('../services/totp')
const { isBlobUrl, readResponsePrefix, ALLOWED_MEDIA_TYPES } = require('../infra/storage/blobStorage')
const { validarAssinaturaMedia } = require('../infra/storage/mediaSignature')

const BCRYPT_COST = 12

const router = Router()

const PROFILE_PLATFORMS = new Set(['instagram', 'facebook', 'youtube', 'tiktok'])
const DEFAULT_NOTIFICATIONS = { email: true, published: true, failures: true, comments: true }

async function avatarValido(url) {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return false
    const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
    if (!contentType.startsWith('image/') || !ALLOWED_MEDIA_TYPES.has(contentType)) return false
    const prefix = await readResponsePrefix(response)
    return validarAssinaturaMedia(prefix, contentType)
  } catch {
    return false
  }
}
const totpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('totp'),
  message: { erro: 'Muitas tentativas de 2FA. Aguarde alguns minutos.' }
})

// GET /api/me/profile — dados editáveis e preferências do usuário.
router.get('/profile', async (req, res) => {
  try {
    const profile = await usersRepo.buscarPerfil(req.user.id)
    if (!profile) return res.status(404).json({ erro: 'Perfil não encontrado.' })
    res.json({ ...profile, notificationPreferences: { ...DEFAULT_NOTIFICATIONS, ...(profile.notificationPreferences || {}) } })
  } catch (e) {
    serverError(res, e, 'Não foi possível carregar seu perfil agora.')
  }
})

// PATCH /api/me/profile — atualiza apenas preferências do próprio usuário.
router.patch('/profile', async (req, res) => {
  try {
    const current = await usersRepo.buscarPerfil(req.user.id)
    if (!current) return res.status(404).json({ erro: 'Perfil não encontrado.' })
    const body = req.body || {}
    const fullName = body.fullName === undefined ? current.fullName : String(body.fullName || '').trim()
    const timezone = body.timezone === undefined ? current.timezone || 'America/Sao_Paulo' : String(body.timezone || '')
    const language = body.language === undefined ? current.language || 'pt-BR' : String(body.language || '')
    const defaultPlatform = body.defaultPlatform === undefined ? current.defaultPlatform : (body.defaultPlatform || null)
    const notificationPreferences = { ...DEFAULT_NOTIFICATIONS, ...(current.notificationPreferences || {}), ...(body.notificationPreferences || {}) }

    if (fullName.length > 255) return res.status(400).json({ erro: 'O nome pode ter no máximo 255 caracteres.' })
    if (!/^(UTC|[A-Za-z_]+\/[A-Za-z_]+)$/.test(timezone)) return res.status(400).json({ erro: 'Fuso horário inválido.' })
    if (!['pt-BR', 'en-US'].includes(language)) return res.status(400).json({ erro: 'Idioma inválido.' })
    if (defaultPlatform && !PROFILE_PLATFORMS.has(defaultPlatform)) return res.status(400).json({ erro: 'Rede padrão inválida.' })
    for (const key of Object.keys(DEFAULT_NOTIFICATIONS)) {
      if (typeof notificationPreferences[key] !== 'boolean') return res.status(400).json({ erro: 'Preferências de notificação inválidas.' })
    }

    const profile = await usersRepo.atualizarPerfil(req.user.id, { fullName: fullName || null, timezone, language, defaultPlatform, notificationPreferences })
    addLog('ok', 'Preferências do perfil atualizadas', null, null, req.user.id)
    res.json({ ...profile, notificationPreferences })
  } catch (e) {
    serverError(res, e, 'Não foi possível salvar seu perfil agora.')
  }
})

// POST /api/me/logout-all — invalida os tokens emitidos antes deste momento.
router.post('/logout-all', async (req, res) => {
  try {
    await usersRepo.invalidarSessoes(req.user.id)
    res.json({ ok: true })
  } catch (e) {
    serverError(res, e, 'Não foi possível encerrar as outras sessões agora.')
  }
})

// POST /api/me/password — usuário logado troca a própria senha.
// Exige a senha atual para confirmar identidade (impede que alguém com a
// sessão aberta de outra pessoa troque a senha sem conhecê-la).
router.post('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {}
    if (!newPassword) return res.status(400).json({ erro: 'Informe a nova senha.' })

    const erroComplexidade = validarComplexidadeSenha(newPassword)
    if (erroComplexidade) return res.status(400).json({ erro: erroComplexidade })

    const cred = await credentialsRepo.buscarPorUserId(req.user.id)
    // Contas criadas só com Google não têm senha local — nesse caso, definir
    // uma senha pela primeira vez não exige a "senha atual".
    if (cred) {
      if (!currentPassword) return res.status(400).json({ erro: 'Informe sua senha atual.' })
      const senhaOk = await bcrypt.compare(currentPassword, cred.password_hash)
      if (!senhaOk) {
        addLog('err', 'Falha ao trocar senha: senha atual incorreta', null, null, req.user.id)
        return res.status(401).json({ erro: 'Senha atual incorreta.' })
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST)
    if (cred) {
      await credentialsRepo.atualizarSenha(req.user.id, passwordHash)
    } else {
      await credentialsRepo.criar(req.user.id, passwordHash)
    }

    await usersRepo.invalidarSessoes(req.user.id)
    addLog('ok', 'Senha alterada com sucesso', null, null, req.user.id)
    res.json({ ok: true })
  } catch (e) {
    serverError(res, e, 'Não foi possível alterar sua senha agora.')
  }
})

// POST /api/me/avatar — define a foto de perfil do usuário logado.
// A imagem já foi enviada ao Vercel Blob pelo navegador (via /api/posts/upload-url),
// então aqui só recebemos a URL pública resultante e a associamos ao usuário.
router.post('/avatar', async (req, res) => {
  try {
    const { avatarUrl } = req.body || {}
    if (avatarUrl !== null && typeof avatarUrl !== 'string')
      return res.status(400).json({ erro: 'avatarUrl inválido.' })

    // Aceita só URLs do nosso storage (Blob) ou null (remover foto) — evita
    // que a coluna seja usada para apontar/refletir uma URL externa arbitrária.
    if (avatarUrl) {
      if (!isBlobUrl(avatarUrl))
        return res.status(400).json({ erro: 'avatarUrl precisa ser uma imagem enviada pelo aplicativo.' })
      if (!(await avatarValido(avatarUrl)))
        return res.status(400).json({ erro: 'O arquivo enviado não é uma imagem válida.' })
    }

    const user = await usersRepo.atualizarAvatar(req.user.id, avatarUrl || null)
    res.json({ avatarUrl: user?.avatarUrl ?? null })
  } catch (e) {
    serverError(res, e, 'Não foi possível atualizar sua foto de perfil agora.')
  }
})

// ── 2FA (TOTP) ─────────────────────────────────────────────────────────────

// POST /api/me/2fa/setup — gera um novo segredo (ainda não habilitado) e
// devolve a otpauth URI para o frontend renderizar o QR code. Só conclui a
// ativação depois que o usuário confirma um código válido (/2fa/enable).
router.post('/2fa/setup', totpLimiter, async (req, res) => {
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const credentials = await credentialsRepo.buscarPorUserId(req.user.id)
    if (!password || !credentials || !(await bcrypt.compare(password, credentials.password_hash))) {
      return res.status(403).json({ erro: 'Confirme sua senha atual antes de configurar o 2FA.' })
    }
    const segredo = totp.gerarSegredo()
    await usersRepo.salvarSegredoTotp(req.user.id, segredo)
    const otpauthUri = totp.gerarOtpauthUri(segredo, req.user.email)
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, { width: 180, margin: 1 })
    res.json({ otpauthUri, secret: segredo, qrCodeDataUrl })
  } catch (e) {
    serverError(res, e, 'Não foi possível iniciar a configuração do 2FA.')
  }
})

// POST /api/me/2fa/enable { code } — confirma o primeiro código do app
// autenticador e ativa o 2FA de fato.
router.post('/2fa/enable', totpLimiter, async (req, res) => {
  try {
    const { code } = req.body || {}
    const info = await usersRepo.buscarTotp(req.user.id)
    if (!info?.secret) return res.status(400).json({ erro: 'Inicie a configuração do 2FA primeiro.' })
    if (!totp.validarCodigo(info.secret, String(code || ''))) {
      return res.status(400).json({ erro: 'Código inválido. Verifique o app autenticador e tente de novo.' })
    }
    await usersRepo.ativarTotp(req.user.id)
    addLog('ok', 'Autenticação em 2 fatores ativada', null, null, req.user.id)
    res.json({ ok: true })
  } catch (e) {
    serverError(res, e, 'Não foi possível ativar o 2FA.')
  }
})

// POST /api/me/2fa/disable { code } — exige um código válido para desativar,
// evitando que alguém com a sessão aberta remova o 2FA sem ter o app.
router.post('/2fa/disable', totpLimiter, async (req, res) => {
  try {
    const { code } = req.body || {}
    const info = await usersRepo.buscarTotp(req.user.id)
    if (!info?.enabled) return res.status(400).json({ erro: 'O 2FA não está ativo.' })
    if (!totp.validarCodigo(info.secret, String(code || ''))) {
      return res.status(400).json({ erro: 'Código inválido. Informe um código do app autenticador para desativar.' })
    }
    await usersRepo.desativarTotp(req.user.id)
    addLog('info', 'Autenticação em 2 fatores desativada', null, null, req.user.id)
    res.json({ ok: true })
  } catch (e) {
    serverError(res, e, 'Não foi possível desativar o 2FA.')
  }
})

module.exports = router
