// Erro de validação de regra de negócio do domínio de posts — o controller
// HTTP traduz isso para 400 com a mensagem do erro.
class ValidationError extends Error {}

module.exports = { ValidationError }
