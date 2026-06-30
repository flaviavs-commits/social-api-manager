function requireAdmin(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin')) return next()

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(403).json({ erro: 'Você não tem permissão para acessar esta área.' })
  }
  res.redirect((process.env.FRONTEND_URL || '') + '/')
}

module.exports = requireAdmin
