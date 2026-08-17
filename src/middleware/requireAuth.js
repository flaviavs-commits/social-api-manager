const usersRepo = require('../repositories/usersRepository')
const { verificarTokenSessaoDetalhado } = require('../utils/authToken')
const { AUTH_COOKIE, readCookie } = require('../utils/authCookie')

async function requireAuth(req, res, next) {
  // Modo público solicitado para a demonstração: todas as requisições usam
  // somente a conta demo configurada, sem exigir login ou senha.
  // O modo público é permitido somente em desenvolvimento explícito. Se
  // NODE_ENV estiver ausente, o processo não pode assumir que é seguro liberar
  // a API: ambientes de produção mal configurados costumam omitir essa
  // variável.
  if (process.env.REVIEW_MODE_NO_AUTH === 'true' && process.env.NODE_ENV === 'development') {
    req.user = {
      id: Number(process.env.REVIEW_MODE_USER_ID) || 38,
      email: 'review-tiktok@demo.local',
      role: 'user',
      plan: 'criador',
      planUnrestricted: true,
      fullName: 'Demonstração',
      avatarUrl: null,
      totpEnabled: false
    }
    return next()
  }

  const header = req.headers.authorization || ''
  // Cookies HttpOnly são o caminho principal. O Bearer continua aceito
  // temporariamente para clientes antigos durante a migração, mas o frontend
  // não o armazena mais em localStorage.
  const token = readCookie(req, AUTH_COOKIE) || (header.startsWith('Bearer ') ? header.slice(7) : null)

  let userId = null
  let tokenInfo = null
  try {
    if (token) {
      tokenInfo = verificarTokenSessaoDetalhado(token)
      if (tokenInfo.purpose !== 'session' || !Number.isSafeInteger(Number(tokenInfo.userId))) throw new Error('Token de sessão inválido')
      if (tokenInfo.iat > Date.now() + 60_000) throw new Error('Token de sessão futuro')
      userId = tokenInfo.userId
    }
  } catch {
    userId = null
  }

  if (!userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ erro: 'Sua sessão expirou. Faça login novamente.' })
    }
    return res.redirect((process.env.FRONTEND_URL || '') + '/login.html')
  }

  try {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('userId inválido')
    userId = Number(userId)
    // Busca sempre o estado atual para que logout-all, troca de senha,
    // desativação e mudança de papel tenham efeito imediato, sem uma janela
    // de sessão válida mantida em cache local da instância.
    const user = await usersRepo.buscarPorId(userId)

    if (!user) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ erro: 'Sua sessão expirou. Faça login novamente.' })
      }
      return res.redirect((process.env.FRONTEND_URL || '') + '/login.html')
    }

    const invalidatedAt = user.auth_tokens_invalidated_at ? new Date(user.auth_tokens_invalidated_at).getTime() : 0
    if (invalidatedAt && (!tokenInfo?.iat || tokenInfo.iat <= invalidatedAt)) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'Sua sessão foi encerrada. Faça login novamente.' })
      return res.redirect((process.env.FRONTEND_URL || '') + '/login.html')
    }

    req.user = { id: user.id, email: user.email, role: user.role, plan: user.plan, planUnrestricted: user.plan_unrestricted === true, fullName: user.full_name, avatarUrl: user.avatar_url ?? null, totpEnabled: user.totp_enabled ?? false }
    next()
  } catch (err) {
    res.status(500).json({ erro: 'Não foi possível verificar sua sessão agora. Tente novamente.' })
  }
}

module.exports = requireAuth
// Mantido como no-op para compatibilidade com o controlador administrativo;
// a consulta acima já não usa cache local.
module.exports.invalidarCacheUsuario = () => {}
