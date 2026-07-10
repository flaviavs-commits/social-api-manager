const { Router } = require('express')
const bcrypt = require('bcrypt')
const QRCode = require('qrcode')
const usersRepo = require('../repositories/usersRepository')
const credentialsRepo = require('../repositories/credentialsRepository')
const { serverError, validarComplexidadeSenha } = require('../utils/http')
const { addLog } = require('../middleware/logger')
const totp = require('../services/totp')

const router = Router()

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

    const passwordHash = await bcrypt.hash(newPassword, 10)
    if (cred) {
      await credentialsRepo.atualizarSenha(req.user.id, passwordHash)
    } else {
      await credentialsRepo.criar(req.user.id, passwordHash)
    }

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
      let parsed
      try { parsed = new URL(avatarUrl) } catch { return res.status(400).json({ erro: 'avatarUrl inválido.' }) }
      if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com'))
        return res.status(400).json({ erro: 'avatarUrl precisa ser uma imagem enviada pelo aplicativo.' })
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
router.post('/2fa/setup', async (req, res) => {
  try {
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
router.post('/2fa/enable', async (req, res) => {
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
router.post('/2fa/disable', async (req, res) => {
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
