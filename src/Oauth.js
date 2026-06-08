const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { addLog } = require('../middleware/logger');

// ─── Meta (Facebook + Instagram) ──────────────────────────────────────────────

router.get('/meta', (req, res) => {
  // Validar credenciais antes de redirecionar
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || appId === 'seu_app_id') {
    addLog('err', 'OAuth Meta falhou: META_APP_ID não configurado no .env', 'facebook');
    return res.status(400).json({
      error: 'META_APP_ID não configurado',
      detail: 'Abra o arquivo .env e preencha META_APP_ID com o ID do seu App em developers.facebook.com',
      steps: [
        '1. Acesse https://developers.facebook.com/apps',
        '2. Crie ou selecione seu App',
        '3. Copie o App ID e cole em META_APP_ID no arquivo .env',
        '4. Copie o App Secret e cole em META_APP_SECRET',
        '5. Reinicie o servidor com npm start'
      ]
    });
  }

  if (!appSecret || appSecret === 'seu_app_secret') {
    addLog('err', 'OAuth Meta falhou: META_APP_SECRET não configurado no .env', 'facebook');
    return res.status(400).json({
      error: 'META_APP_SECRET não configurado',
      detail: 'Preencha META_APP_SECRET no arquivo .env com o App Secret do seu App Meta.'
    });
  }

  const { accountName, group, platform } = req.query;
  const state = Buffer.from(JSON.stringify({ accountName, group, platform })).toString('base64');
  const scopes = [
    'pages_manage_posts',
    'pages_read_engagement',
    'instagram_content_publish',
    'instagram_basic',
    'public_profile'
  ].join(',');

  const url = `https://www.facebook.com/v18.0/dialog/oauth` +
    `?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&response_type=code`;

  addLog('info', `OAuth Meta iniciado para "${accountName}" [${platform}]`, platform);
  res.json({ authUrl: url });
});

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    addLog('err', `OAuth Meta cancelado pelo usuário: ${error}`);
    return res.redirect('/?error=oauth_cancelled');
  }

  let meta = {};
  try { meta = JSON.parse(Buffer.from(state, 'base64').toString()); } catch {}

  try {
    // Em produção: troca code por access_token
    // const tokenRes = await axios.post('https://graph.facebook.com/oauth/access_token', ...)
    // Simulando resposta para fins de desenvolvimento:
    const fakeToken = 'EAABx_' + Math.random().toString(36).slice(2, 18).toUpperCase();
    const expiresAt = new Date(Date.now() + 60 * 86400000).toISOString();

    const accountId = 'acc_' + Date.now();
    db.get('accounts').push({
      id: accountId,
      name: meta.accountName || 'Nova Conta Meta',
      platform: meta.platform || 'facebook',
      group: meta.group || 'Geral',
      status: 'active',
      createdAt: new Date().toISOString()
    }).write();

    db.get('tokens').push({
      id: 'tok_' + Date.now(),
      accountId,
      platform: meta.platform || 'facebook',
      accessToken: fakeToken,
      expiresAt,
      status: 'valid'
    }).write();

    addLog('ok', `Conta Meta conectada: "${meta.accountName}" — token expira em 60 dias`, meta.platform, accountId);
    res.redirect('/?connected=true');
  } catch (err) {
    addLog('err', `Falha no callback Meta: ${err.message}`);
    res.redirect('/?error=oauth_failed');
  }
});

// ─── Google / YouTube ──────────────────────────────────────────────────────────

router.get('/google', (req, res) => {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || clientId === 'seu_client_id') {
    addLog('err', 'OAuth Google falhou: GOOGLE_CLIENT_ID não configurado no .env', 'youtube');
    return res.status(400).json({
      error: 'GOOGLE_CLIENT_ID não configurado',
      detail: 'Acesse console.cloud.google.com → APIs → Credenciais → OAuth 2.0 e preencha GOOGLE_CLIENT_ID no .env'
    });
  }
  if (!clientSecret || clientSecret === 'seu_client_secret') {
    addLog('err', 'OAuth Google falhou: GOOGLE_CLIENT_SECRET não configurado no .env', 'youtube');
    return res.status(400).json({
      error: 'GOOGLE_CLIENT_SECRET não configurado',
      detail: 'Preencha GOOGLE_CLIENT_SECRET no arquivo .env.'
    });
  }

  const { accountName, group } = req.query;
  const state = Buffer.from(JSON.stringify({ accountName, group, platform: 'youtube' })).toString('base64');
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
  ].join(' ');

  const url = `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${state}`;

  addLog('info', `OAuth Google iniciado para "${accountName}"`, 'youtube');
  res.json({ authUrl: url });
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    addLog('err', `OAuth Google cancelado: ${error}`);
    return res.redirect('/?error=oauth_cancelled');
  }

  let meta = {};
  try { meta = JSON.parse(Buffer.from(state, 'base64').toString()); } catch {}

  try {
    // Em produção: troca code por tokens via https://oauth2.googleapis.com/token
    const fakeAccessToken = 'ya29.A0A_' + Math.random().toString(36).slice(2, 20);
    const fakeRefreshToken = '1//0g_' + Math.random().toString(36).slice(2, 30);
    const expiresAt = new Date(Date.now() + 1 * 3600000).toISOString(); // access token: 1h

    const accountId = 'acc_' + Date.now();
    db.get('accounts').push({
      id: accountId,
      name: meta.accountName || 'Novo Canal YouTube',
      platform: 'youtube',
      group: meta.group || 'Geral',
      status: 'active',
      createdAt: new Date().toISOString()
    }).write();

    db.get('tokens').push({
      id: 'tok_' + Date.now(),
      accountId,
      platform: 'youtube',
      accessToken: fakeAccessToken,
      refreshToken: fakeRefreshToken,
      expiresAt,
      status: 'valid'
    }).write();

    addLog('ok', `Canal YouTube conectado: "${meta.accountName}" — refresh token salvo`, 'youtube', accountId);
    res.redirect('/?connected=true');
  } catch (err) {
    addLog('err', `Falha no callback Google: ${err.message}`);
    res.redirect('/?error=oauth_failed');
  }
});

// ─── TikTok ───────────────────────────────────────────────────────────────────

router.get('/tiktok', (req, res) => {
  const clientKey    = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || clientKey === 'seu_client_key') {
    addLog('err', 'OAuth TikTok falhou: TIKTOK_CLIENT_KEY não configurado no .env', 'tiktok');
    return res.status(400).json({
      error: 'TIKTOK_CLIENT_KEY não configurado',
      detail: 'Acesse developers.tiktok.com → seu App → preencha TIKTOK_CLIENT_KEY no .env'
    });
  }

  const { accountName, group } = req.query;
  const state = Buffer.from(JSON.stringify({ accountName, group, platform: 'tiktok' })).toString('base64');

  const url = `https://www.tiktok.com/v2/auth/authorize/` +
    `?client_key=${process.env.TIKTOK_CLIENT_KEY}` +
    `&response_type=code` +
    `&scope=user.info.basic,video.publish` +
    `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI)}` +
    `&state=${state}`;

  addLog('info', `OAuth TikTok iniciado para "${accountName}"`, 'tiktok');
  res.json({ authUrl: url });
});

router.get('/tiktok/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    addLog('err', `OAuth TikTok cancelado: ${error}`);
    return res.redirect('/?error=oauth_cancelled');
  }

  let meta = {};
  try { meta = JSON.parse(Buffer.from(state, 'base64').toString()); } catch {}

  try {
    // Em produção: POST para https://open.tiktokapis.com/v2/oauth/token/
    const fakeToken = 'act.' + Math.random().toString(36).slice(2, 20);
    const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString(); // TikTok: 24h

    const accountId = 'acc_' + Date.now();
    db.get('accounts').push({
      id: accountId,
      name: meta.accountName || 'Nova Conta TikTok',
      platform: 'tiktok',
      group: meta.group || 'Geral',
      status: 'active',
      createdAt: new Date().toISOString()
    }).write();

    db.get('tokens').push({
      id: 'tok_' + Date.now(),
      accountId,
      platform: 'tiktok',
      accessToken: fakeToken,
      expiresAt,
      status: 'valid'
    }).write();

    addLog('ok', `Conta TikTok conectada: "${meta.accountName}" — token expira em 24h`, 'tiktok', accountId);
    res.redirect('/?connected=true');
  } catch (err) {
    addLog('err', `Falha no callback TikTok: ${err.message}`);
    res.redirect('/?error=oauth_failed');
  }
});

module.exports = router;