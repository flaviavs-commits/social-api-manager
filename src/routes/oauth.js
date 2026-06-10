const express = require('express');
const router = express.Router();
const contasRepo = require('../repositories/contasRepository');
const tokensRepo = require('../repositories/tokensRepository');
const { addLog } = require('../middleware/logger');

// Verifica se uma credencial obrigatória foi preenchida no .env.
// Retorna o erro (formato esperado pelo front-end) ou null se estiver tudo ok.
function checkEnv(vars, platform) {
  for (const name of vars) {
    const value = process.env[name];
    if (!value || value.startsWith('seu_')) {
      addLog('err', `OAuth ${platform} falhou: ${name} não configurado no .env`, platform);
      return {
        error: `${name} não configurado`,
        detail: `Abra o arquivo .env e preencha ${name} com a credencial correspondente.`,
        steps: [
          '1. Abra o arquivo .env na raiz do projeto',
          `2. Preencha a variável ${name}`,
          '3. Reinicie o servidor com npm start'
        ]
      };
    }
  }
  return null;
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

router.get('/meta', (req, res) => {
  const configError = checkEnv(['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI'], 'facebook');
  if (configError) return res.status(400).json(configError);

  const { accountName, group } = req.query;
  const platform = 'facebook';
  const state = Buffer.from(JSON.stringify({ accountName, group, platform })).toString('base64');
  const scopes = [
    'pages_manage_posts',
    'pages_read_engagement',
    'public_profile'
  ].join(',');

  const url = `https://www.facebook.com/v18.0/dialog/oauth` +
    `?client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&response_type=code`;

  addLog('info', `OAuth Facebook iniciado para "${accountName}"`, platform);
  res.json({ authUrl: url });
});

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    addLog('err', `OAuth Facebook cancelado pelo usuário: ${error}`);
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
    const platform = 'facebook';

    const conta = await contasRepo.criarContaRapida({
      name: meta.accountName || 'Nova Conta Facebook',
      platform,
      group: meta.group || 'Geral'
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform,
      accessToken: fakeToken,
      expiresAt,
      accountName: meta.accountName || 'Nova Conta Facebook'
    });

    addLog('ok', `Conta Facebook conectada: "${meta.accountName}" — token expira em 60 dias`, platform, conta.id);
    res.redirect('/?connected=true');
  } catch (err) {
    addLog('err', `Falha no callback Facebook: ${err.message}`);
    res.redirect('/?error=oauth_failed');
  }
});

// ─── Instagram (Instagram API with Instagram Login) ───────────────────────────

router.get('/instagram', (req, res) => {
  const configError = checkEnv(['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_REDIRECT_URI'], 'instagram');
  if (configError) {
    configError.steps = [
      '1. Acesse https://developers.facebook.com e abra seu App',
      '2. Adicione o produto "Instagram" (Instagram API with Instagram Login)',
      '3. Em "Configurações da API do Instagram", copie o Instagram App ID e Instagram App Secret',
      '4. Preencha INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET no arquivo .env',
      '5. Reinicie o servidor com npm start'
    ];
    return res.status(400).json(configError);
  }

  const { accountName, group } = req.query;
  const platform = 'instagram';
  const state = Buffer.from(JSON.stringify({ accountName, group, platform })).toString('base64');
  const scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_messages'
  ].join(',');

  const url = `https://www.instagram.com/oauth/authorize` +
    `?client_id=${process.env.INSTAGRAM_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.INSTAGRAM_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&response_type=code`;

  addLog('info', `OAuth Instagram iniciado para "${accountName}"`, platform);
  res.json({ authUrl: url });
});

router.get('/instagram/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    addLog('err', `OAuth Instagram cancelado pelo usuário: ${error}`);
    return res.redirect('/?error=oauth_cancelled');
  }

  let meta = {};
  try { meta = JSON.parse(Buffer.from(state, 'base64').toString()); } catch {}

  try {
    // Em produção: troca code por access_token via
    // POST https://api.instagram.com/oauth/access_token (login da página do Instagram)
    // Simulando resposta para fins de desenvolvimento:
    const fakeToken = 'IGQVJ_' + Math.random().toString(36).slice(2, 18).toUpperCase();
    const expiresAt = new Date(Date.now() + 60 * 86400000).toISOString();
    const platform = 'instagram';

    const conta = await contasRepo.criarContaRapida({
      name: meta.accountName || 'Nova Conta Instagram',
      platform,
      group: meta.group || 'Geral'
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform,
      accessToken: fakeToken,
      expiresAt,
      accountName: meta.accountName || 'Nova Conta Instagram'
    });

    addLog('ok', `Conta Instagram conectada: "${meta.accountName}" — token expira em 60 dias`, platform, conta.id);
    res.redirect('/?connected=true');
  } catch (err) {
    addLog('err', `Falha no callback Instagram: ${err.message}`);
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

    const conta = await contasRepo.criarContaRapida({
      name: meta.accountName || 'Novo Canal YouTube',
      platform: 'youtube',
      group: meta.group || 'Geral'
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform: 'youtube',
      accessToken: fakeAccessToken,
      refreshToken: fakeRefreshToken,
      expiresAt,
      accountName: meta.accountName || 'Novo Canal YouTube'
    });

    addLog('ok', `Canal YouTube conectado: "${meta.accountName}" — refresh token salvo`, 'youtube', conta.id);
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

    const conta = await contasRepo.criarContaRapida({
      name: meta.accountName || 'Nova Conta TikTok',
      platform: 'tiktok',
      group: meta.group || 'Geral'
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform: 'tiktok',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      accountName: meta.accountName || 'Nova Conta TikTok'
    });

    addLog('ok', `Conta TikTok conectada: "${meta.accountName}"`, 'tiktok', conta.id);
    res.redirect('/?connected=true');
  } catch (err) {
    addLog('err', `Falha no callback TikTok: ${err.message}`);
    res.redirect('/?error=oauth_failed');
  }
});

module.exports = router;