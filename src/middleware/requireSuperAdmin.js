function requireSuperAdmin(req, res, next) {
  if (req.user && req.user.role === 'super_admin') return next()

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(403).json({ erro: 'Apenas o administrador principal pode fazer isso.' })
  }
  res.redirect('/')
}

module.exports = requireSuperAdmin
