const usersRepo = require('../repositories/usersRepository')
const { verificarTokenSessaoDetalhado } = require('../utils/authToken')

// Cache de usuário autenticado: evita uma query ao banco por request.
// TTL de 60 segundos — suficiente para a maioria das navegações, curto
// o bastante para que mudanças de role/ativo se propaguem rapidamente.
const userCache = new Map()
const USER_CACHE_TTL_MS = 60_000

function getCachedUser(userId) {
  const entry = userCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { userCache.delete(userId); return null }
  return entry.user
}

function setCachedUser(userId, user) {
  userCache.set(userId, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS })
}

// Permite invalidar o cache imediatamente quando role ou ativo mudar.
function invalidarCacheUsuario(userId) {
  userCache.delete(userId)
}

async function requireAuth(req, res, next) {
  // Bypass temporário para permitir que o Google revise a aplicação sem
  // login — ativado só com REVIEW_MODE_NO_AUTH=true no ambiente. Enquanto
  // ligado, TODA a API fica pública (dados de todos os usuários incluídos).
  // Desligar (remover a env var) restaura a autenticação normal sem precisar
  // reverter código. NUNCA deixar ligado além do período estrito da revisão.
  // O modo de revisão nunca pode interferir em testes automatizados, mesmo
  // quando um `.env` local o deixa configurado para homologação.
  if (process.env.REVIEW_MODE_NO_AUTH === 'true' && process.env.NODE_ENV !== 'test') {
    req.user = { id: Number(process.env.REVIEW_MODE_USER_ID) || null, email: 'review@local', role: 'user', fullName: 'Revisor', avatarUrl: null, totpEnabled: false }
    return next()
  }

  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  let userId = null
  let tokenInfo = null
  try {
    if (token) {
      tokenInfo = verificarTokenSessaoDetalhado(token)
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
    let user = process.env.NODE_ENV === 'test' ? null : getCachedUser(userId)
    if (!user) {
      user = await usersRepo.buscarPorId(userId)
      if (user) setCachedUser(userId, user)
    }

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

    req.user = { id: user.id, email: user.email, role: user.role, fullName: user.full_name, avatarUrl: user.avatar_url ?? null, totpEnabled: user.totp_enabled ?? false }
    next()
  } catch (err) {
    res.status(500).json({ erro: 'Não foi possível verificar sua sessão agora. Tente novamente.' })
  }
}

module.exports = requireAuth
module.exports.invalidarCacheUsuario = invalidarCacheUsuario
