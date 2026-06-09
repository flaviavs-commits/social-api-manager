const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { addLog } = require('../middleware/logger');

// ─── Meta (Facebook + Instagram) ──────────────────────────────────────────────

router.get('/meta', (req, res) => {
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
    `?client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI)}` +
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

router.get('/tiktok/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    addLog('err', `OAuth TikTok cancelado: ${error}`);
    return res.redirect('/?error=oauth_cancelled');
  }

  let meta = {};
  try { meta = JSON.parse(Buffer.from(state, 'base64').toString()); } catch {}

  try {
    // Troca o code pelo access_token real
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI
      })
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      addLog('err', `Erro ao obter token TikTok: ${tokenData.error_description}`);
      return res.redirect('/?error=token_failed');
    }

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
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      status: 'valid'
    }).write();

    addLog('ok', `Conta TikTok conectada: "${meta.accountName}"`, 'tiktok', accountId);
    res.redirect('/?connected=true');
  } catch (err) {
    addLog('err', `Falha no callback TikTok: ${err.message}`);
    res.redirect('/?error=oauth_failed');
  }
});

module.exports = router;