const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const contasRepo = require('../repositories/contasRepository');
const tokensRepo = require('../repositories/tokensRepository');
const { addLog } = require('../middleware/logger');
const requireAuth = require('../middleware/requireAuth');

// Estado do PKCE do TikTok fica no Postgres (tabela oauth_pkce_state), não em
// memória — entre o início do OAuth e o callback, a requisição pode cair numa
// instância de função serverless diferente, perdendo qualquer Map em memória.
async function salvarPkceVerifier(state, codeVerifier) {
  // O state é determinístico (signState dos mesmos dados gera o mesmo valor),
  // então reiniciar um OAuth com a mesma conta reusa a chave. UPSERT sobrescreve
  // o verifier anterior em vez de estourar a unique constraint — um INSERT cru
  // lançava um erro não tratado que derrubava o processo inteiro.
  await pool.query(
    `INSERT INTO oauth_pkce_state (state, code_verifier) VALUES ($1, $2)
     ON CONFLICT (state) DO UPDATE SET code_verifier = EXCLUDED.code_verifier, criado_em = NOW()`,
    [state, codeVerifier]
  );
}

async function consumirPkceVerifier(state) {
  const { rows: [row] } = await pool.query(`DELETE FROM oauth_pkce_state WHERE state = $1 RETURNING code_verifier`, [state]);
  return row?.code_verifier || null;
}

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
  // tiktokUser vem do username retornado pela API do TikTok (input externo) —
  // interpolá-lo direto na string JS permitiria XSS via username malicioso
  // (ex: "');alert(document.cookie);('"). JSON.stringify escapa o valor com
  // segurança para o contexto JS, e encodeURIComponent o sanitiza para a URL.
  const profileScript = tiktokUser
    ? `window.open('https://www.tiktok.com/@' + encodeURIComponent(${JSON.stringify(String(tiktokUser))}), '_blank');`
    : '';
  const frontendUrl = process.env.FRONTEND_URL || '';
  return `<!DOCTYPE html><html><body><script>
    if (window.opener) {
      window.opener.location.href = '${frontendUrl}/?connected=true';
      ${profileScript}
      window.close();
    } else { window.location.href = '${frontendUrl}/?connected=true'; }
  </script></body></html>`;
}

function popupError(msg) {
  const frontendUrl = process.env.FRONTEND_URL || '';
  return `<!DOCTYPE html><html><body><script>
    if (window.opener) { window.opener.location.href = '${frontendUrl}/?error=${msg}'; window.close(); }
    else { window.location.href = '${frontendUrl}/?error=${msg}'; }
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
    const platform = 'facebook';

    // 1. Troca o code por um access_token real
    const { data: tokenData } = await fetchJsonWithRetry(`https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${process.env.META_APP_ID}` +
      `&client_secret=${encodeURIComponent(process.env.META_APP_SECRET)}` +
      `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI)}` +
      `&code=${encodeURIComponent(code)}`);

    if (tokenData.error || !tokenData.access_token) {
      addLog('err', `Erro ao obter token Facebook: ${JSON.stringify(tokenData)}`, platform, null, meta.userId);
      return res.send(popupError('token_failed'));
    }

    // 2. Troca o token de curta duração por um long-lived token (60 dias)
    const { data: longData } = await fetchJsonWithRetry(`https://graph.facebook.com/v19.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${process.env.META_APP_ID}` +
      `&client_secret=${encodeURIComponent(process.env.META_APP_SECRET)}` +
      `&fb_exchange_token=${encodeURIComponent(tokenData.access_token)}`);

    const accessToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || tokenData.expires_in || 60 * 86400;

    // 3. Busca o ID e o nome do usuário/página conectada
    const { data: profileData } = await fetchJsonWithRetry(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
    const accountName = meta.accountName || profileData.name || 'Nova Conta Facebook';
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const conta = await contasRepo.criarContaRapida({
      name: accountName,
      platform,
      userId: meta.userId,
      externalUserId: profileData.id ? String(profileData.id) : null
    });

    await tokensRepo.salvarToken({
      accountId: conta.id,
      platform,
      accessToken,
      expiresAt,
      accountName
    });

    addLog('ok', `Conta Facebook conectada: "${accountName}" — token expira em ${Math.round(expiresIn / 86400)} dias`, platform, conta.id, meta.userId);
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

    // 2. Troca o token de curta duração por um long-lived token (60 dias).
    // Fluxo "Instagram API with Instagram Login": GET em graph.instagram.com/v19.0/access_token
    // com grant_type=ig_exchange_token (mesmo host/versão usados no resto do código).
    const exchangeUrl = 'https://graph.instagram.com/v19.0/access_token?' + new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      access_token: shortData.access_token
    }).toString();

    let { data: longData } = await fetchJsonWithRetry(exchangeUrl, { method: 'GET' }, { retries: 2, delayMs: 500 });

    if (longData.error || !longData.access_token) {
      addLog('err', `Erro ao gerar long-lived token Instagram: ${JSON.stringify(longData)} | shortData=${JSON.stringify(shortData)}`, platform, null, meta.userId);
      return res.send(popupError('token_failed'));
    }

    // 3. Busca o username e a foto de perfil da conta conectada
    const { data: profileData } = await fetchJsonWithRetry(`https://graph.instagram.com/v19.0/me?fields=user_id,username,profile_picture_url&access_token=${longData.access_token}`);
    const accountName = meta.accountName || profileData.username || 'Nova Conta Instagram';

    const expiresAt = new Date(Date.now() + (longData.expires_in || 60 * 86400) * 1000).toISOString();

    const conta = await contasRepo.criarContaRapida({
      name: accountName,
      platform,
      userId: meta.userId,
      avatarUrl: profileData.profile_picture_url || null,
      externalUserId: profileData.user_id ? String(profileData.user_id) : null
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
    'https://www.googleapis.com/auth/youtube.readonly',
    // Necessário para o gráfico de tempo de visualização no Analytics
    // (YouTube Analytics API) — contas conectadas antes deste scope existir
    // precisam ser reconectadas.
    'https://www.googleapis.com/auth/yt-analytics.readonly'
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

// Monta a URL de autorização do TikTok e persiste o PKCE — compartilhado pelas
// duas rotas de início de OAuth (/tiktok e /tiktok/google), que só diferem no
// conjunto de scopes pedido e em metadados extras gravados no state.
async function iniciarOAuthTiktok(req, res, { scopes, stateExtra = {}, logMessage }) {
  const configError = checkEnv(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'], 'tiktok');
  if (configError) return res.status(400).json(configError);

  const { accountName } = req.query;
  const platform = 'tiktok';

  // Qualquer falha aqui (ex.: banco indisponível ao salvar o PKCE) precisa virar
  // uma resposta de erro — sem o try/catch, a rejeição não tratada derrubava o
  // processo inteiro e reiniciava o servidor a cada tentativa de conexão.
  try {
    const state = signState({ accountName, platform, userId: req.user.id, ...stateExtra });

    // PKCE — TikTok exige HEX encoding para code_challenge (não base64url)
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');
    await salvarPkceVerifier(state, codeVerifier);

    const url = `https://www.tiktok.com/v2/auth/authorize/` +
      `?client_key=${process.env.TIKTOK_CLIENT_KEY}` +
      `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI)}` +
      `&scope=${scopes.join(',')}` +
      `&state=${state}` +
      `&response_type=code` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256`;

    addLog('info', logMessage, platform, null, req.user.id);
    res.json({ authUrl: url });
  } catch (err) {
    addLog('err', `Falha ao iniciar OAuth TikTok: ${err.message}`, platform, null, req.user?.id);
    res.status(500).json({ error: 'Não foi possível iniciar a conexão com o TikTok. Tente novamente.' });
  }
}

// Scopes solicitados no OAuth do TikTok — os mesmos pedidos no App Review.
// Mantidos numa constante única para os dois fluxos (direto e via Google) não
// divergirem: pedir um scope não aprovado faz o TikTok rejeitar o login.
// - user.info.basic/profile: identificar a conta conectada (nome, avatar)
// - video.publish/upload: publicar vídeos/fotos na conta do usuário
// user.info.stats (Analytics de seguidores/curtidas) e video.list (lista de
// vídeos no painel) foram removidos da submissão porque não foram demonstrados
// no vídeo de review — o TikTok reprova scope pedido mas não mostrado. As
// funções que os usam (metricsStatsAtuaisTiktok/metricsVideosTiktok) já tratam
// o 403 resultante, então o app degrada sem quebrar. Readicionar aqui + na
// submissão quando forem demonstrados num vídeo.
const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'video.publish',
  'video.upload'
];

router.get('/tiktok', requireAuth, async (req, res) => {
  await iniciarOAuthTiktok(req, res, {
    scopes: TIKTOK_SCOPES,
    logMessage: `OAuth TikTok iniciado para "${req.query.accountName}"`
  });
});

router.get('/tiktok/google', requireAuth, async (req, res) => {
  await iniciarOAuthTiktok(req, res, {
    scopes: TIKTOK_SCOPES,
    stateExtra: { via: 'google' },
    logMessage: 'OAuth TikTok (Google) iniciado'
  });
});

// Verificação de propriedade do domínio exigida pelo TikTok Developer Portal
// ao cadastrar o redirect_uri de produção — o portal baixa esse arquivo em
// /oauth/tiktok/callback/<arquivo>.txt e espera o conteúdo exato de volta.
router.get('/tiktok/callback/tiktok8RW5tE6U5KtspoaJfaF4BrZNNqLurSkp.txt', (req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=8RW5tE6U5KtspoaJfaF4BrZNNqLurSkp');
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

  const codeVerifier = await consumirPkceVerifier(state);

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
      const errMsg = tokenData.error?.message || tokenData.error_description || tokenData.error || 'Resposta sem access_token'
      addLog('err', `Erro ao obter token TikTok: ${errMsg}`, 'tiktok', null, meta.userId)
      // invalid_grant: code expirado/já usado (ex: usuário recarregou a página do
      // callback) — diferente de uma falha real de configuração/credenciais.
      const popupCode = tokenData.error === 'invalid_grant' ? 'oauth_cancelled' : 'token_failed'
      return res.send(popupError(popupCode))
    }

    // expires_in é obrigatório para calcular a expiração do token — sem ele,
    // `Date.now() + undefined * 1000` vira NaN, salvando "Invalid Date" no banco.
    if (!token.expires_in) {
      addLog('err', `Token TikTok sem expires_in na resposta: ${JSON.stringify(token)}`, 'tiktok', null, meta.userId)
      return res.send(popupError('token_failed'))
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

// Header TikTok-Signature no formato "t=<timestamp>,s=<hex_signature>" —
// a assinatura é HMAC-SHA256("<timestamp>.<raw_body>") usando o client secret.
// MAX_SIGNATURE_AGE_MS limita o replay de uma requisição antiga capturada por
// um atacante (a comparação usa epoch UTC, igual ao timestamp do header).
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

function verificarAssinaturaWebhookTiktok(rawBody, signatureHeader) {
  if (!rawBody || !signatureHeader) return false;

  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const { t: timestamp, s: signature } = parts;
  if (!timestamp || !signature) return false;

  if (Math.abs(Date.now() - Number(timestamp) * 1000) > MAX_SIGNATURE_AGE_MS) return false;

  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expectedSignature = crypto.createHmac('sha256', process.env.TIKTOK_CLIENT_SECRET).update(payload).digest('hex');

  // timingSafeEqual exige buffers do mesmo tamanho — comparar hashes de
  // tamanho fixo evita expor por timing se a assinatura está parcialmente correta.
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// Verificação de propriedade do domínio exigida pelo TikTok Developer Portal
// ao cadastrar a webhook URL de produção — mesmo esquema da verificação do
// redirect_uri, mas servida sob /tiktok/webhook/<arquivo>.txt.
router.get('/tiktok/webhook/tiktokVJrQeuVTcCX3GoxtvKkHE17EL032WtiC.txt', (req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=VJrQeuVTcCX3GoxtvKkHE17EL032WtiC');
});

// O TikTok envia eventos assíncronos (ex: revogação de autorização) via POST
// para este endpoint, separado do redirect_uri do login (que só recebe GET
// do navegador do usuário). req.rawBody é capturado em server.js, antes do
// express.json() global consumir o stream, e é exigido para validar a
// assinatura antes de confiar no conteúdo.
router.post('/tiktok/webhook', (req, res) => {
  if (!verificarAssinaturaWebhookTiktok(req.rawBody, req.header('TikTok-Signature'))) {
    addLog('err', 'Webhook TikTok rejeitado: assinatura inválida ou ausente', 'tiktok');
    return res.status(401).json({ erro: 'Assinatura inválida' });
  }

  addLog('info', `Webhook TikTok recebido: ${req.body?.event || 'evento desconhecido'}`, 'tiktok');
  res.status(200).json({ received: true });
});

// ─── Data Deletion Callback (exigido pela Meta para apps em modo Live) ──────────
// Quando um usuário remove o app pelas configurações do Facebook/Instagram, a
// Meta chama esta URL com um signed_request contendo o user_id dele — temos
// que apagar (ou agendar a exclusão de) os dados associados e responder no
// formato exigido: { url, confirmation_code }.
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

function decodificarSignedRequest(signedRequest, appSecret) {
  const [encodedSig, encodedPayload] = signedRequest.split('.');
  if (!encodedSig || !encodedPayload) throw new Error('signed_request malformado');

  const expectedSig = crypto.createHmac('sha256', appSecret)
    .update(encodedPayload)
    .digest('base64url');

  if (expectedSig !== encodedSig) throw new Error('Assinatura do signed_request inválida');

  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
}

async function processarExclusaoDados(platform, externalUserId) {
  const contas = await contasRepo.buscarContasPorExternalUserId(platform, externalUserId);
  for (const conta of contas) {
    await contasRepo.apagarDadosDaConta(conta.id);
    addLog('ok', `Dados apagados via Data Deletion Callback [${platform}] — external_user_id=${externalUserId}`, platform, null, conta.userId);
  }
  return contas.length;
}

router.post('/meta/data-deletion', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const payload = decodificarSignedRequest(req.body.signed_request, process.env.META_APP_SECRET);
    const confirmationCode = crypto.randomBytes(16).toString('hex');

    // A exclusão roda em background: a Meta exige resposta imediata com o
    // status_url de acompanhamento, sem esperar o apagamento terminar.
    processarExclusaoDados('facebook', payload.user_id).catch(err => {
      addLog('err', `Falha ao processar Data Deletion Callback: ${err.message}`, 'facebook');
    });

    res.json({
      url: `${process.env.BASE_URL}/oauth/meta/data-deletion/status?id=${confirmationCode}`,
      confirmation_code: confirmationCode
    });
  } catch (err) {
    addLog('err', `Data Deletion Callback rejeitado: ${err.message}`, 'facebook');
    res.status(400).json({ error: err.message });
  }
});

// Página simples de status exigida pela Meta para acompanhar a confirmação —
// como a exclusão é imediata (sem fila assíncrona de longa duração), sempre
// responde como concluída.
router.get('/meta/data-deletion/status', (req, res) => {
  res.send(`<!DOCTYPE html><html><body>Solicitação ${req.query.id || ''} processada: os dados foram apagados.</body></html>`);
});

module.exports = router;
