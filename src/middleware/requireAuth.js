const usersRepo = require('../repositories/usersRepository')

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ erro: 'Sua sessão expirou. Faça login novamente.' })
    }
    return res.redirect('/login.html')
  }

  try {
    const user = await usersRepo.buscarPorId(req.session.userId)
    if (!user) {
      req.session.destroy(() => {})
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ erro: 'Sua sessão expirou. Faça login novamente.' })
      }
      return res.redirect('/login.html')
    }

    req.user = { id: user.id, email: user.email, role: user.role, fullName: user.full_name }
    next()
  } catch (err) {
    res.status(500).json({ erro: 'Não foi possível verificar sua sessão agora. Tente novamente.' })
  }
}

module.exports = requireAuth
