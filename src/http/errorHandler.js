const { ValidationError } = require('../domain/posts/errors')

function statusOf(error) {
  if (error instanceof ValidationError) return 400
  if (error?.statusCode) return error.statusCode
  if (error?.status) return error.status
  if (/^2[23]/.test(error?.code || '')) return 400
  return 500
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)

  const status = statusOf(error)
  if (status >= 500) console.error(error)

  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido' })
  }

  const message = status >= 500
    ? 'Erro interno do servidor'
    : (error.publicMessage || error.message || 'Requisição inválida')
  return res.status(status).json({ erro: message })
}

module.exports = { errorHandler, statusOf }
