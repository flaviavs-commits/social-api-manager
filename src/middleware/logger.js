const db = require('../db/database');

function addLog(type, message, platform = null, accountId = null) {
  const logs = db.get('logs');
  const entry = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type,       // ok | err | warn | info
    message,
    platform,
    accountId,
    timestamp: new Date().toISOString()
  };
  logs.push(entry).write();
  // Manter só os últimos 500 logs
  const all = logs.value();
  if (all.length > 500) {
    db.set('logs', all.slice(all.length - 500)).write();
  }
  return entry;
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
