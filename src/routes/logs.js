const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { addLog } = require('../middleware/logger');

// GET /api/logs — lista logs recentes
router.get('/', (req, res) => {
  const { type, platform, limit = 100 } = req.query;
  let logs = db.get('logs').value();

  if (type) logs = logs.filter(l => l.type === type);
  if (platform) logs = logs.filter(l => l.platform === platform);

  // Mais recentes primeiro
  logs = logs.slice(-parseInt(limit)).reverse();
  res.json({ logs, total: logs.length });
});

// GET /api/logs/stream — SSE para logs em tempo real
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let lastCount = db.get('logs').value().length;

  const interval = setInterval(() => {
    const logs = db.get('logs').value();
    if (logs.length > lastCount) {
      const newLogs = logs.slice(lastCount);
      newLogs.forEach(log => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });
      lastCount = logs.length;
    }
  }, 500);

  req.on('close', () => clearInterval(interval));
});

// DELETE /api/logs — limpar logs
router.delete('/', (req, res) => {
  db.set('logs', []).write();
  addLog('info', 'Logs limpos pelo usuário');
  res.json({ success: true });
});

module.exports = router;
