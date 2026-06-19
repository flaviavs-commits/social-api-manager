const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const contasRepo = require('../repositories/contasRepository');
const tokensRepo = require('../repositories/tokensRepository');
const { addLog } = require('../middleware/logger');
const requireAuth = require('../middleware/requireAuth');

const tiktokPKCEStore = new Map(); // state -> code_verifier

// O callback de OAuth é navegado pelo provedor externo (Instagram/Google/...)
// de volta para o nosso domínio. Nesse ponto o cookie de sessão pode não
// chegar de forma confiável (popup + redirect cross-site), então não dá pra
// depender de req.user ali. Em vez disso, assinamos o userId dentro do
// próprio "state" (HMAC com SESSION_SECRET) — o provedor devolve esse state
// inalterado, e validamos a assinatura no callback antes de usá-lo.
function signState(payload) {
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(json).digest('hex');
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64');
}

function verifyState(state) {
  const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
  const { sig, ...payload } = decoded;
  const expectedSig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(JSON.stringify(payload)).digest('hex');
  if (sig !== expectedSig) throw new Error('state inválido ou adulterado');
  return payload;
}

// As APIs de OAuth (Meta/Instagram/Google/TikTok) ocasionalmente respondem com
// falhas transitórias (5xx ou erros instáveis tipo "Unsupported request" da
// Graph API). Sem retry, isso derruba a conexão da conta mesmo quando uma
// segunda tentativa teria funcionado.
async function fetchWithRetry(url, options, { retries = 2, delayMs = 600 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Algumas respostas de erro da Graph API (ex: "Unsupported request - method
// type: get") são falhas momentâneas do lado da Meta, não problemas reais de
// payload — uma nova tentativa idêntica costuma funcionar.
function isTransientGraphError(data) {
  const msg = data?.error?.message || data?.error_message || '';
  return /unsupported request/i.test(msg);
}

async function fetchJsonWithRetry(url, options, { retries = 2, delayMs = 600 } = {}) {
  let lastData;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchWithRetry(url, options, { retries: 0 });
    const data = await res.json();
    if (res.ok && !data.error && !data.error_message) return { res, data };
    lastData = { res, data };
    if (attempt < retries && (res.status >= 500 || isTransientGraphError(data))) {
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      continue;
    }
    return lastData;
  }
  return lastData;
}

function popupSuccess(tiktokUser) {
  const profileScript = tiktokUser
    ? `window.open('https://www.tiktok.com/@${tiktokUser}', '_blank');`
    : '';
  return `<!DOCTYPE html><html><body><script>
    if (window.opener) {
      window.opener.location.href = '/?connected=true';
      ${profileScript}
      window.close();
    } else { window.location.href = '/?connected=true'; }
  </script></body></html>`;
}

function popupError(msg) {
  return `<!DOCTYPE html><html><body><script>
    if (window.opener) { window.opener.location.href = '/?error=${msg}'; window.close(); }
    else { window.location.href = '/?error=${msg}'; }
  </script></body></html>`;
}

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

router.get('/meta', requireAuth, (req, res) => {
  const configError = checkEnv(['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI'], 'facebook');
  if (configError) return res.status(400).json(configError);

  const { accountName } = req.query;
  const platform = 'facebook';
  const state = signState({ accountName, platform, userId: req.user.id });
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

  addLog('info', `OAuth Facebook iniciado para "${accountName}"`, platform, null, req.user.id);
  res.json({ authUrl: url });
});

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;

  let meta = {};
  try { meta = verifyState(state); } catch {}

  if (error) {
    addLog('err', `OAuth Facebook cancelado pelo usuário: ${error}`, null, null, meta.userId);
    return res.send(popupError('oauth_cancelled'));
  }

  if (!meta.userId) {
    addLog('err', 'Falha no callback Facebook: state inválido ou sem usuário associado');
    return res.send(popupError('oauth_failed'));
  }

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
      userId: meta.userId
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform,
      accessToken: fakeToken,
      expiresAt,
      accountName: meta.accountName || 'Nova Conta Facebook'
    });

    addLog('ok', `Conta Facebook conectada: "${meta.accountName}" — token expira em 60 dias`, platform, conta.id, meta.userId);
    res.send(popupSuccess());
  } catch (err) {
    addLog('err', `Falha no callback Facebook: ${err.message}`, null, null, meta.userId);
    res.send(popupError('oauth_failed'));
  }
});

// ─── Instagram (Instagram API with Instagram Login) ───────────────────────────

router.get('/instagram', requireAuth, (req, res) => {
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

  const { accountName } = req.query;
  const platform = 'instagram';
  const state = signState({ accountName, platform, userId: req.user.id });
  const scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_messages',
    // Necessário para o endpoint /insights (visualizações de foto/carrossel
    // no Analytics) — sem isso a API responde 403 mesmo com token válido.
    'instagram_business_manage_insights'
  ].join(',');

  const url = `https://www.instagram.com/oauth/authorize` +
    `?client_id=${process.env.INSTAGRAM_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.INSTAGRAM_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&response_type=code`;

  addLog('info', `OAuth Instagram iniciado para "${accountName}"`, platform, null, req.user.id);
  res.json({ authUrl: url });
});

router.get('/instagram/callback', async (req, res) => {
  const { code, state, error } = req.query;

  let meta = {};
  try { meta = verifyState(state); } catch {}

  const platform = 'instagram';

  if (error) {
    addLog('err', `OAuth Instagram cancelado pelo usuário: ${error}`, platform, null, meta.userId);
    return res.send(popupError('oauth_cancelled'));
  }

  if (!meta.userId) {
    addLog('err', 'Falha no callback Instagram: state inválido ou sem usuário associado', platform);
    return res.send(popupError('oauth_failed'));
  }

  try {
    // 1. Troca o code por um token de curta duração
    const { res: shortRes, data: shortData } = await fetchJsonWithRetry('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
        code
      })
    });

    if (shortData.error_message || !shortData.access_token) {
      addLog('err', `Erro ao obter token Instagram: ${shortData.error_message || JSON.stringify(shortData)}`, platform, null, meta.userId);
      return res.send(popupError('token_failed'));
    }

    // 2. Troca o token de curta duração por um long-lived token (60 dias)
    const { data: longData } = await fetchJsonWithRetry(`https://graph.instagram.com/access_token` +
      `?grant_type=ig_exchange_token` +
      `&client_secret=${encodeURIComponent(process.env.INSTAGRAM_APP_SECRET)}` +
      `&access_token=${encodeURIComponent(shortData.access_token)}`);

    if (longData.error || !longData.access_token) {
      addLog('err', `Erro ao gerar long-lived token Instagram: ${JSON.stringify(longData)} | shortData=${JSON.stringify(shortData)}`, platform, null, meta.userId);
      return res.send(popupError('token_failed'));
    }

    // 3. Busca o username e a foto de perfil da conta conectada
    const { data: profileData } = await fetchJsonWithRetry(`https://graph.instagram.com/me?fields=user_id,username,profile_picture_url&access_token=${longData.access_token}`);
    const accountName = meta.accountName || profileData.username || 'Nova Conta Instagram';

    const expiresAt = new Date(Date.now() + (longData.expires_in || 60 * 86400) * 1000).toISOString();

    const conta = await contasRepo.criarContaRapida({
      name: accountName,
      platform,
      userId: meta.userId,
      avatarUrl: profileData.profile_picture_url || null
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform,
      accessToken: longData.access_token,
      expiresAt,
      accountName
    });

    addLog('ok', `Conta Instagram conectada: "${accountName}" — token expira em 60 dias`, platform, conta.id, meta.userId);
    res.send(popupSuccess());
  } catch (err) {
    addLog('err', `Falha no callback Instagram: ${err.message}`, platform, null, meta.userId);
    res.send(popupError('oauth_failed'));
  }
});

// ─── Google / YouTube ──────────────────────────────────────────────────────────

router.get('/google', requireAuth, (req, res) => {
  const { accountName } = req.query;
  const state = signState({ accountName, platform: 'youtube', userId: req.user.id });
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

  addLog('info', `OAuth Google iniciado para "${accountName}"`, 'youtube', null, req.user.id);
  res.json({ authUrl: url });
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  let meta = {};
  try { meta = verifyState(state); } catch {}

  if (error) {
    addLog('err', `OAuth Google cancelado: ${error}`, 'youtube', null, meta.userId);
    return res.send(popupError('oauth_cancelled'));
  }

  if (!meta.userId) {
    addLog('err', 'Falha no callback Google: state inválido ou sem usuário associado', 'youtube');
    return res.send(popupError('oauth_failed'));
  }

  try {
    // 1. Troca o code pelos tokens reais
    const { data: tokenData } = await fetchJsonWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        code
      })
    });

    if (tokenData.error || !tokenData.access_token) {
      addLog('err', `Erro ao obter token Google: ${JSON.stringify(tokenData)}`, 'youtube', null, meta.userId);
      return res.send(popupError('token_failed'));
    }

    // 2. Busca o nome do canal conectado
    const { data: channelData } = await fetchJsonWithRetry('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const channelSnippet = channelData.items?.[0]?.snippet;
    const accountName = meta.accountName || channelSnippet?.title || 'Novo Canal YouTube';

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

    const conta = await contasRepo.criarContaRapida({
      name: accountName,
      platform: 'youtube',
      userId: meta.userId,
      avatarUrl: channelSnippet?.thumbnails?.default?.url || null
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform: 'youtube',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      accountName
    });

    addLog('ok', `Canal YouTube conectado: "${accountName}" — refresh token salvo`, 'youtube', conta.id, meta.userId);
    res.send(popupSuccess());
  } catch (err) {
    addLog('err', `Falha no callback Google: ${err.message}`, 'youtube', null, meta.userId);
    res.send(popupError('oauth_failed'));
  }
});

// ─── TikTok ───────────────────────────────────────────────────────────────────

router.get('/tiktok', requireAuth, (req, res) => {
  const configError = checkEnv(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'], 'tiktok');
  if (configError) return res.status(400).json(configError);

  const { accountName } = req.query;
  const platform = 'tiktok';
  const state = signState({ accountName, platform, userId: req.user.id });
  const scopes = [
    'user.info.basic',
    'user.info.profile',
    'video.list',
    'video.publish',
    'video.upload'
  ].join(',');

  // PKCE — TikTok exige HEX encoding para code_challenge (não base64url)
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');
  tiktokPKCEStore.set(state, codeVerifier);

  const url = `https://www.tiktok.com/v2/auth/authorize/` +
    `?client_key=${process.env.TIKTOK_CLIENT_KEY}` +
    `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&response_type=code` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  addLog('info', `OAuth TikTok iniciado para "${accountName}"`, platform, null, req.user.id);
  res.json({ authUrl: url });
});

router.get('/tiktok/google', requireAuth, (req, res) => {
  const configError = checkEnv(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'], 'tiktok');
  if (configError) return res.status(400).json(configError);

  const { accountName } = req.query;
  const platform = 'tiktok';
  const state = signState({ platform, via: 'google', accountName, userId: req.user.id });
  const scopes = ['user.info.basic', 'video.publish', 'video.upload'].join(',');

  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');
  tiktokPKCEStore.set(state, codeVerifier);

  const url = `https://www.tiktok.com/v2/auth/authorize/` +
    `?client_key=${process.env.TIKTOK_CLIENT_KEY}` +
    `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&state=${state}` +
    `&response_type=code` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  addLog('info', `OAuth TikTok (Google) iniciado`, platform, null, req.user.id);
  res.json({ authUrl: url });
});

router.get('/tiktok/callback', async (req, res) => {
  const { code, state, error } = req.query;

  let meta = {};
  try { meta = verifyState(state); } catch {}

  if (error) {
    addLog('err', `OAuth TikTok cancelado: ${error}`, 'tiktok', null, meta.userId);
    return res.send(popupError('oauth_cancelled'));
  }

  if (!meta.userId) {
    addLog('err', 'Falha no callback TikTok: state inválido ou sem usuário associado');
    return res.send(popupError('oauth_failed'));
  }

  const codeVerifier = tiktokPKCEStore.get(state);
  tiktokPKCEStore.delete(state);

  try {
    // Troca o code pelo access_token real
    const { data: tokenData } = await fetchJsonWithRetry('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {})
      })
    });

    // TikTok pode retornar o token na raiz ou em { data: {...} }
    const token = tokenData.data ?? tokenData;
    if (!token?.access_token) {
      const errMsg = tokenData.error?.message || tokenData.error_description || 'token_failed';
      addLog('err', `Erro ao obter token TikTok: ${errMsg}`, 'tiktok', null, meta.userId);
      return res.send(popupError('token_failed'));
    }

    // Busca o perfil para obter username e foto de perfil
    let accountName = meta.accountName;
    let tiktokUsername = null;
    let tiktokAvatarUrl = null;
    try {
      const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,username,avatar_url', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const profileData = await profileRes.json();
      tiktokUsername = profileData?.data?.user?.username;
      tiktokAvatarUrl = profileData?.data?.user?.avatar_url || null;
      if (!accountName) accountName = tiktokUsername || profileData?.data?.user?.display_name;
    } catch {}
    accountName = accountName || 'Nova Conta TikTok';

    const conta = await contasRepo.criarContaRapida({
      name: accountName,
      platform: 'tiktok',
      userId: meta.userId,
      avatarUrl: tiktokAvatarUrl
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform: 'tiktok',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      accountName
    });

    addLog('ok', `Conta TikTok conectada: "${accountName}"`, 'tiktok', conta.id, meta.userId);
    res.send(popupSuccess(tiktokUsername));
  } catch (err) {
    addLog('err', `Falha no callback TikTok: ${err.message}`, 'tiktok', null, meta.userId);
    res.send(popupError('oauth_failed'));
  }
});

// ─── Kwai (sem OAuth público - conexão simulada, igual ao Facebook) ──────────

router.get('/kwai', requireAuth, async (req, res) => {
  const { accountName } = req.query;
  const platform = 'kwai';

  try {
    // O Kwai não disponibiliza OAuth público; a conta é conectada de forma
    // simulada (mesmo padrão usado no callback do Facebook).
    const fakeToken = 'KWAI_' + Math.random().toString(36).slice(2, 18).toUpperCase();
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const name = accountName || 'Nova Conta Kwai';

    const conta = await contasRepo.criarContaRapida({
      name,
      platform,
      userId: req.user.id
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform,
      accessToken: fakeToken,
      expiresAt,
      accountName: name
    });

    addLog('ok', `Conta Kwai conectada: "${name}" — token expira em 30 dias`, platform, conta.id, req.user.id);
    res.json({ connected: true, accountId: conta.id });
  } catch (err) {
    addLog('err', `Falha ao conectar Kwai: ${err.message}`, platform, null, req.user.id);
    res.status(500).json({ error: 'Falha ao conectar conta Kwai' });
  }
});

module.exports = router;
