// Helpers compartilhados pelas rotas: parsing seguro de parâmetros e respostas de erro
// que não expõem detalhes internos (mensagens de erro do Postgres, stack traces etc.)

const PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'kwai']
const REPEATS = ['none', 'daily', 'weekly', 'monthly']
const TIPOS = ['ESTRELA', 'NICHO', 'APOIO', 'PROVA SOCIAL']

// Converte :id em inteiro positivo ou retorna null se inválido
function parseId(value) {
  if (!/^\d+$/.test(String(value))) return null
  return Number(value)
}

// Papéis com acesso administrativo (veem/gerenciam dados de todos os usuários).
// 'super_admin' é o único que pode promover/despromover outros usuários.
function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin'
}

// Loga o erro completo no servidor e responde com mensagem genérica ao cliente.
// Erros de validação/constraint do Postgres (códigos 22xxx/23xxx) viram 400
// com mensagem genérica; o resto vira 500, sem expor detalhes internos.
function serverError(res, err, message = 'Erro interno do servidor') {
  console.error(err)
  const code = err?.code || ''
  if (/^2[23]/.test(code)) {
    return res.status(400).json({ erro: 'Dados inválidos para esta operação' })
  }
  res.status(500).json({ erro: message })
}

module.exports = { PLATFORMS, REPEATS, TIPOS, parseId, serverError, isAdminRole }
