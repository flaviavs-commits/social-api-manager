const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { addLog } = require('../middleware/logger');

// Atualiza status dos tokens baseado na data de expiração
function refreshTokenStatuses() {
  const tokens = db.get('tokens').value();
  const now = Date.now();
  const sevenDays = 7 * 86400000;

  tokens.forEach(token => {
    const expiry = new Date(token.expiresAt).getTime();
    let newStatus = token.status;

    if (expiry < now) newStatus = 'expired';
    else if (expiry - now < sevenDays) newStatus = 'expiring';
    else newStatus = 'valid';

    if (newStatus !== token.status) {
      db.get('tokens').find({ id: token.id }).assign({ status: newStatus }).write();
    }
  });
}

// GET /api/tokens — lista tokens com info da conta
router.get('/', (req, res) => {
  refreshTokenStatuses();
  const { status, platform } = req.query;
  let tokens = db.get('tokens').value();
  const accounts = db.get('accounts').value();

  if (status) tokens = tokens.filter(t => t.status === status);
  if (platform) tokens = tokens.filter(t => t.platform === platform);

  const enriched = tokens.map(token => {
    const account = accounts.find(a => a.id === token.accountId) || {};
    const expiry = new Date(token.expiresAt);
    const daysLeft = Math.ceil((expiry - Date.now()) / 86400000);
    return {
      ...token,
      accessToken: token.accessToken.slice(0, 10) + '...' + token.accessToken.slice(-4),
      accountName: account.name || 'Conta removida',
      daysLeft: daysLeft > 0 ? daysLeft : 0,
      expiryLabel: daysLeft > 0 ? `${daysLeft} dias` : 'expirado'
    };
  });

  res.json({ tokens: enriched, total: enriched.length });
});

// ── NOVO: POST /api/tokens — adicionar token manualmente ──────────────────────
router.post('/', (req, res) => {
  const { accountId, platform, accessToken, refreshToken, expiresAt } = req.body;

  if (!accountId)   return res.status(400).json({ error: 'accountId é obrigatório' });
  if (!platform)    return res.status(400).json({ error: 'platform é obrigatório' });
  if (!accessToken) return res.status(400).json({ error: 'accessToken é obrigatório' });
  if (!expiresAt)   return res.status(400).json({ error: 'expiresAt é obrigatório' });

  const account = db.get('accounts').find({ id: accountId }).value();
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

  // Remove token antigo da mesma conta, se existir
  db.get('tokens').remove({ accountId }).write();

  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  const sevenDays = 7 * 86400000;
  const status = expiry < now ? 'expired'
    : expiry - now < sevenDays ? 'expiring'
    : 'valid';

  const token = {
    id: 'tok_' + Date.now(),
    accountId,
    platform,
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: new Date(expiresAt).toISOString(),
    status,
    addedManually: true,
    createdAt: new Date().toISOString()
  };

  db.get('tokens').push(token).write();

  // Atualiza status da conta conforme o token
  db.get('accounts').find({ id: accountId }).assign({
    status: status === 'expired' ? 'error' : 'active'
  }).write();

  addLog('ok',
    `Token adicionado manualmente: "${account.name}" [${platform}] — expira em ${new Date(expiresAt).toLocaleDateString('pt-BR')}`,
    platform, accountId
  );

  res.status(201).json({
    token: {
      ...token,
      accessToken: accessToken.slice(0, 10) + '...' + accessToken.slice(-4)
    }
  });
});
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/tokens/renew/:id — renovar token específico
router.post('/renew/:id', async (req, res) => {
  const token = db.get('tokens').find({ id: req.params.id }).value();
  if (!token) return res.status(404).json({ error: 'Token não encontrado' });

  const account = db.get('accounts').find({ id: token.accountId }).value();

  // YouTube usa refresh_token — pode renovar automaticamente
  if (token.platform === 'youtube' && token.refreshToken) {
    try {
      // Em produção: POST https://oauth2.googleapis.com/token com grant_type=refresh_token
      const newAccessToken = 'ya29.A0A_renewed_' + Math.random().toString(36).slice(2, 16);
      const newExpiry = new Date(Date.now() + 3600000).toISOString();

      db.get('tokens').find({ id: token.id }).assign({
        accessToken: newAccessToken,
        expiresAt: newExpiry,
        status: 'valid',
        renewedAt: new Date().toISOString()
      }).write();

      addLog('ok', `Token YouTube renovado automaticamente: "${account?.name}"`, 'youtube', token.accountId);
      return res.json({ success: true, message: 'Token renovado via refresh_token', newExpiry });
    } catch (err) {
      addLog('err', `Falha ao renovar token YouTube: ${err.message}`, 'youtube', token.accountId);
      return res.status(500).json({ error: 'Falha na renovação automática' });
    }
  }

  // Facebook — tokens de longa duração podem ser estendidos
  if (token.platform === 'facebook') {
    try {
      // Em produção: GET /oauth/access_token?grant_type=fb_exchange_token
      const newExpiry = new Date(Date.now() + 60 * 86400000).toISOString();
      db.get('tokens').find({ id: token.id }).assign({
        expiresAt: newExpiry,
        status: 'valid',
        renewedAt: new Date().toISOString()
      }).write();

      addLog('ok', `Token Facebook estendido: "${account?.name}" → +60 dias`, 'facebook', token.accountId);
      return res.json({ success: true, message: 'Token estendido por mais 60 dias', newExpiry });
    } catch (err) {
      addLog('err', `Falha ao estender token Facebook: ${err.message}`, 'facebook');
      return res.status(500).json({ error: 'Falha na extensão do token' });
    }
  }

  // Instagram e TikTok exigem reconexão manual
  addLog('warn', `Token ${token.platform} exige reconexão manual: "${account?.name}"`, token.platform, token.accountId);
  res.json({
    success: false,
    requiresReconnect: true,
    message: `${token.platform} exige que o usuário reconecte manualmente via OAuth`,
    oauthUrl: `/oauth/${token.platform === 'instagram' ? 'meta' : token.platform}?accountName=${encodeURIComponent(account?.name || '')}`
  });
});

// POST /api/tokens/renew-all — renovar todos os expirados/expirando
router.post('/renew-all', async (req, res) => {
  refreshTokenStatuses();
  const toRenew = db.get('tokens').filter(t => t.status === 'expired' || t.status === 'expiring').value();

  const results = { renewed: [], requiresManual: [], failed: [] };

  for (const token of toRenew) {
    const account = db.get('accounts').find({ id: token.accountId }).value();
    if (token.platform === 'youtube' && token.refreshToken) {
      const newExpiry = new Date(Date.now() + 3600000).toISOString();
      db.get('tokens').find({ id: token.id }).assign({ status: 'valid', expiresAt: newExpiry, renewedAt: new Date().toISOString() }).write();
      results.renewed.push(account?.name || token.id);
      addLog('ok', `Auto-renovado: "${account?.name}" [youtube]`, 'youtube', token.accountId);
    } else if (token.platform === 'facebook') {
      const newExpiry = new Date(Date.now() + 60 * 86400000).toISOString();
      db.get('tokens').find({ id: token.id }).assign({ status: 'valid', expiresAt: newExpiry, renewedAt: new Date().toISOString() }).write();
      results.renewed.push(account?.name || token.id);
      addLog('ok', `Auto-renovado: "${account?.name}" [facebook]`, 'facebook', token.accountId);
    } else {
      results.requiresManual.push(account?.name || token.id);
      addLog('warn', `Reconexão manual necessária: "${account?.name}" [${token.platform}]`, token.platform, token.accountId);
    }
  }

  res.json({ ...results, total: toRenew.length });
});

module.exports = router;