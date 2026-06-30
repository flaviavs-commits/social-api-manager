const usersRepo = require('../repositories/usersRepository')
const { verificarTokenSessao } = require('../utils/authToken')

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
    const user = await usersRepo.buscarPorId(userId)
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
