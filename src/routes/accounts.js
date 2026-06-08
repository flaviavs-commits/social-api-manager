const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { addLog } = require('../middleware/logger');

// GET /api/accounts — lista todas as contas com seus tokens
router.get('/', (req, res) => {
  const { platform, group, status } = req.query;
  let accounts = db.get('accounts').value();

  if (platform) accounts = accounts.filter(a => a.platform === platform);
  if (group) accounts = accounts.filter(a => a.group === group);
  if (status) accounts = accounts.filter(a => a.status === status);

  // Enriquecer com status do token
  const tokens = db.get('tokens').value();
  accounts = accounts.map(acc => {
    const token = tokens.find(t => t.accountId === acc.id);
    return { ...acc, tokenStatus: token ? token.status : 'no_token', tokenExpiry: token ? token.expiresAt : null };
  });

  res.json({ accounts, total: accounts.length });
});

// GET /api/accounts/stats — estatísticas por plataforma
router.get('/stats', (req, res) => {
  const accounts = db.get('accounts').value();
  const tokens = db.get('tokens').value();

  const platforms = ['facebook', 'instagram', 'youtube', 'tiktok'];
  const stats = platforms.map(platform => {
    const platAccounts = accounts.filter(a => a.platform === platform);
    const platTokens = tokens.filter(t => t.platform === platform);
    return {
      platform,
      total: platAccounts.length,
      active: platAccounts.filter(a => a.status === 'active').length,
      error: platAccounts.filter(a => a.status === 'error').length,
      validTokens: platTokens.filter(t => t.status === 'valid').length,
      expiringTokens: platTokens.filter(t => t.status === 'expiring').length,
      expiredTokens: platTokens.filter(t => t.status === 'expired').length,
    };
  });

  const totalAccounts = accounts.length;
  const validTokensTotal = tokens.filter(t => t.status === 'valid').length;
  const expiringTokensTotal = tokens.filter(t => t.status === 'expiring').length;
  const errorTotal = accounts.filter(a => a.status === 'error').length;

  res.json({ platforms: stats, summary: { totalAccounts, validTokensTotal, expiringTokensTotal, errorTotal } });
});

// GET /api/accounts/groups — lista grupos únicos
router.get('/groups', (req, res) => {
  const accounts = db.get('accounts').value();
  const groups = [...new Set(accounts.map(a => a.group))];
  res.json({ groups });
});

// POST /api/accounts — criar conta manualmente (sem OAuth)
router.post('/', (req, res) => {
  const { name, platform, group } = req.body;
  if (!name || !platform) return res.status(400).json({ error: 'name e platform são obrigatórios' });

  const account = {
    id: 'acc_' + Date.now(),
    name,
    platform,
    group: group || 'Geral',
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  db.get('accounts').push(account).write();
  addLog('info', `Conta criada: "${name}" [${platform}]`, platform, account.id);
  res.status(201).json({ account });
});

// DELETE /api/accounts/:id — remover conta e token
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const account = db.get('accounts').find({ id }).value();
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  db.get('accounts').remove({ id }).write();
  db.get('tokens').remove({ accountId: id }).write();

  addLog('warn', `Conta removida: "${account.name}" [${account.platform}]`, account.platform, id);
  res.json({ success: true });
});

module.exports = router;
