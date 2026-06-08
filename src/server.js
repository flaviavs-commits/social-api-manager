require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { requestLogger, addLog } = require('./middleware/logger');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(requestLogger);

// ── Rotas API ─────────────────────────────────────────────────────────────────
app.use('/oauth',        require('./routes/oauth'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/tokens',   require('./routes/tokens'));
app.use('/api/posts',    require('./routes/posts'));
app.use('/api/logs',     require('./routes/logs'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
});

// Fallback — serve o front-end para qualquer rota não-API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Iniciar ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Social API Manager rodando em http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔌 API:       http://localhost:${PORT}/api\n`);
  addLog('ok', `Servidor iniciado na porta ${PORT}`);
  startScheduler();
});

module.exports = app;
