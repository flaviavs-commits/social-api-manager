const { registrarLog } = require('../repositories/logsRepository')
const { safeMessage } = require('../utils/redact')

function addLog(type, message, platform = null, accountId = null, userId = null) {
  return registrarLog({ type, message: safeMessage(message), platform, conta_id: accountId, user_id: userId })
    .catch(err => console.error('Erro ao registrar log:', safeMessage(err?.message)))
}

// Middleware que loga toda requisição de API
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const type = res.statusCode >= 400 ? 'err' : 'ok';
    addLog(type, `${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
}

module.exports = { addLog, requestLogger };
