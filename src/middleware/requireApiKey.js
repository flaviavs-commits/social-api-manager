const crypto = require('crypto')
const pool = require('../db/pool')
const usersRepo = require('../repositories/usersRepository')

async function requireApiKey(req, res, next) {
  const value = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!value || !value.startsWith('mk_')) return res.status(401).json({ erro: 'Informe uma API key em X-API-Key.' })
  const hash = crypto.createHash('sha256').update(value).digest('hex')
  try {
    // Validação e marcação de uso precisam ser uma única decisão no banco.
    // Assim, uma revogação concorrente não deixa uma leitura antiga passar
    // antes do UPDATE separado.
    const { rows } = await pool.query(
      'UPDATE api_keys SET last_used_at=NOW() WHERE key_hash=$1 AND revoked_at IS NULL RETURNING id,user_id',
      [hash]
    )
    if (!rows.length) return res.status(401).json({ erro: 'API key inválida ou revogada.' })
    const user = await usersRepo.buscarPorId(rows[0].user_id)
    if (!user) return res.status(401).json({ erro: 'Usuário da API key não está ativo.' })
    req.apiKeyId = rows[0].id
    req.user = user
    next()
  } catch (err) { res.status(500).json({ erro: 'Não foi possível validar a API key.' }) }
}

module.exports = requireApiKey
