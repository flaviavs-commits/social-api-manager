const usersRepo = require('../repositories/usersRepository')
const { verificarTokenSessao } = require('../utils/authToken')

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
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  let userId = null
  try {
    if (token) userId = verificarTokenSessao(token)
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
    let user = getCachedUser(userId)
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

    req.user = { id: user.id, email: user.email, role: user.role, fullName: user.full_name, avatarUrl: user.avatar_url ?? null, totpEnabled: user.totp_enabled ?? false }
    next()
  } catch (err) {
    res.status(500).json({ erro: 'Não foi possível verificar sua sessão agora. Tente novamente.' })
  }
}

module.exports = requireAuth
module.exports.invalidarCacheUsuario = invalidarCacheUsuario
