const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const contasRepo = require('../repositories/contasRepository');
const tokensRepo = require('../repositories/tokensRepository');
const zernioClient = require('../infra/social/zernioClient');
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
// exp: 10 minutos — janela suficiente para o usuário completar o consentimento
// no provedor, mas curta o bastante para que um state vazado (ex.: em log de
// proxy/histórico do navegador) não fique reutilizável indefinidamente.
const STATE_TTL_MS = 10 * 60 * 1000;

function signState(payload) {
  const withExp = { ...payload, exp: Date.now() + STATE_TTL_MS };
  const json = JSON.stringify(withExp);
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(json).digest('hex');
  return Buffer.from(JSON.stringify({ ...withExp, sig })).toString('base64');
}

function verifyState(state) {
  const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
  const { sig, ...payload } = decoded;
  const expectedSig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(JSON.stringify(payload)).digest('hex');
  // Comparação em tempo constante — mesmo padrão usado em authToken.js e
  // mediaToken.js; `!==` direto vazaria a assinatura correta por timing.
  const sigBuf = Buffer.from(String(sig || ''));
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('state inválido ou adulterado');
  }
  if (payload.exp && Date.now() > payload.exp) throw new Error('state expirado');
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

const ZERNIO_PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };

// O Zernio (docs.zernio.com) processa o OAuth inteiro sozinho para
// Facebook/Instagram/TikTok — não manda nenhum "code" pra gente processar,
// quando o navegador chega no nosso /*/zernio-return a conta JÁ está
// conectada do lado deles. Só precisamos descobrir QUAL conta foi essa (o
// Zernio não sabe nada sobre nosso userId) e espelhar em contas/tokens. A
// heurística é a mesma já usada em contasRepository.criarContaRapida para
// outras redes: como não há um ID de correlação direto, casamos pela conta
// mais recente daquela plataforma — suficiente para o uso atual (uma
// conexão por vez), mas pode casar errado se o usuário conectar 2 contas da
// mesma rede em abas paralelas.
async function syncZernioAccount(platform, userId, accountName) {
  const { accounts } = await zernioClient.listAccounts();
  const daPlataforma = accounts.filter(a => a.platform === platform);
  const escolhida = daPlataforma[daPlataforma.length - 1];
  if (!escolhida) throw new Error(`Nenhuma conta do ${ZERNIO_PLATFORM_LABELS[platform] || platform} encontrada no Zernio após a conexão`);

  const nomeFinal = accountName || escolhida.username || escolhida.name || `Nova Conta ${ZERNIO_PLATFORM_LABELS[platform] || platform}`;
  const conta = await contasRepo.criarContaRapida({
    name: nomeFinal,
    platform,
    userId,
    avatarUrl: escolhida.profilePictureUrl || escolhida.avatarUrl || null,
    externalUserId: escolhida._id
  });

  await contasRepo.definirZernioAccountId(conta.id, escolhida._id);

  // Sem token real pra guardar (o Zernio detém o token) — grava o próprio
  // accountId do Zernio no lugar do access_token (já é uma string opaca) e
  // sem data de expiração: quem renova é o Zernio, não nós. calcularStatus()
  // já trata expiresAt=null como 'valid' permanentemente.
  await tokensRepo.salvarToken({
    accountId: conta.id,
    platform,
    accessToken: escolhida._id,
    expiresAt: null,
    accountName: nomeFinal
  });

  return conta;
}

// ─── Facebook (via Zernio, docs.zernio.com) ────────────────────────────────────
// Mesmo padrão do Instagram (ver bloco abaixo) — o Zernio processa o OAuth
// inteiro e devolve o navegador para /meta/zernio-return via o parâmetro
// redirectUrl. Antes conectava via JS SDK (FB.login), agora usa o mesmo
// popup+redirect das demais redes — troca refletida em public/app.html
// (startOAuth, oauthMap.facebook = 'meta').

router.get('/meta', requireAuth, async (req, res) => {
  const configError = checkEnv(['ZERNIO_API_KEY', 'ZERNIO_PROFILE_ID'], 'facebook');
  if (configError) return res.status(400).json(configError);

  const { accountName } = req.query;
  const platform = 'facebook';
  const state = signState({ accountName, platform, userId: req.user.id });
  const redirectUrl = `${(process.env.BASE_URL || '').replace(/\/$/, '')}/auth/meta/zernio-return?state=${encodeURIComponent(state)}`;

  try {
    const { authUrl } = await zernioClient.connectUrl(platform, process.env.ZERNIO_PROFILE_ID, redirectUrl);
    addLog('info', `OAuth Facebook (via Zernio) iniciado para "${accountName}"`, platform, null, req.user.id);
    res.json({ authUrl });
  } catch (err) {
    addLog('err', `Falha ao iniciar OAuth Facebook via Zernio: ${err.message}`, platform, null, req.user.id);
    res.status(502).json({ error: 'Não foi possível iniciar a conexão com o Facebook no momento.' });
  }
});

router.get('/meta/zernio-return', async (req, res) => {
  const { state } = req.query;

  let meta = {};
  try { meta = verifyState(state); } catch {}

  const platform = 'facebook';

  if (!meta.userId) {
    addLog('err', 'Falha no retorno do Zernio (Facebook): state inválido ou sem usuário associado', platform);
    return res.send(popupError('oauth_failed'));
  }

  try {
    const conta = await syncZernioAccount(platform, meta.userId, meta.accountName);
    addLog('ok', `Conta Facebook conectada via Zernio: "${conta.handle}"`, platform, conta.id, meta.userId);
    res.send(popupSuccess());
  } catch (err) {
    addLog('err', `Falha ao sincronizar conta Facebook do Zernio: ${err.message}`, platform, null, meta.userId);
    res.send(popupError('oauth_failed'));
  }
});

// Troca um access_token de usuário do Facebook (curta ou já longa duração)
// por um long-lived token (60 dias), busca o perfil e salva a conta —
// compartilhado pelo callback de redirect (/meta/callback) e pelo login via
// JS SDK (/meta/sdk-login), que chegam num access_token de formas diferentes
// mas terminam no mesmo lugar: token trocado + conta salva.
async function finalizarConexaoFacebook(shortLivedToken, { accountName, userId }) {
  const platform = 'facebook';

  const { data: longData } = await fetchJsonWithRetry(`https://graph.facebook.com/v19.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${process.env.META_APP_ID}` +
    `&client_secret=${encodeURIComponent(process.env.META_APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`);

  const accessToken = longData.access_token || shortLivedToken;
  const expiresIn = longData.expires_in || 60 * 86400;

  const { data: profileData } = await fetchJsonWithRetry(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
  const nomeFinal = accountName || profileData.name || 'Nova Conta Facebook';
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const conta = await contasRepo.criarContaRapida({
    name: nomeFinal,
    platform,
    userId,
    externalUserId: profileData.id ? String(profileData.id) : null
  });

  await tokensRepo.salvarToken({
    accountId: conta.id,
    platform,
    accessToken,
    expiresAt,
    accountName: nomeFinal
  });

  addLog('ok', `Conta Facebook conectada: "${nomeFinal}" — token expira em ${Math.round(expiresIn / 86400)} dias`, platform, conta.id, userId);
  return conta;
}

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
    // 1. Troca o code por um access_token real
    const { data: tokenData } = await fetchJsonWithRetry(`https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${process.env.META_APP_ID}` +
      `&client_secret=${encodeURIComponent(process.env.META_APP_SECRET)}` +
      `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI)}` +
      `&code=${encodeURIComponent(code)}`);

    if (tokenData.error || !tokenData.access_token) {
      addLog('err', `Erro ao obter token Facebook: ${JSON.stringify(tokenData)}`, 'facebook', null, meta.userId);
      return res.send(popupError('token_failed'));
    }

    // 2. Troca o token de curta duração, busca o perfil e salva a conta
    await finalizarConexaoFacebook(tokenData.access_token, { accountName: meta.accountName, userId: meta.userId });
    res.send(popupSuccess());
  } catch (err) {
    addLog('err', `Falha no callback Facebook: ${err.message}`, null, null, meta.userId);
    res.send(popupError('oauth_failed'));
  }
});

// Conexão via Facebook JS SDK (FB.login() no navegador) — o front-end já
// recebe um access_token de usuário pronto do próprio SDK (popup gerenciado
// pelo Facebook, sem redirect de página inteira) e só repassa esse token
// aqui para virar long-lived e salvar a conta. Diferente de /meta/callback,
// não há "state" assinado: a requisição já chega autenticada (requireAuth),
// então o userId vem direto de req.user, não precisa viajar escondido numa URL.
router.post('/meta/sdk-login', requireAuth, async (req, res) => {
  const configError = checkEnv(['META_APP_ID', 'META_APP_SECRET'], 'facebook');
  if (configError) return res.status(400).json(configError);

  const { accessToken, accountName } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken é obrigatório' });

  try {
    const conta = await finalizarConexaoFacebook(accessToken, { accountName, userId: req.user.id });
    res.json({ success: true, accountId: conta.id });
  } catch (err) {
    addLog('err', `Falha no login via SDK do Facebook: ${err.message}`, null, null, req.user.id);
    res.status(500).json({ error: 'Não foi possível conectar a conta do Facebook.' });
  }
});

// ─── Instagram (via Zernio, docs.zernio.com) ───────────────────────────────────
// O Instagram passou a ser conectado através do Zernio, um provedor terceiro
// que detém o app já auditado pela Meta e o token OAuth real — nosso lado só
// guarda o accountId que o Zernio devolve (contas.zernio_account_id, ver
// migrations/040). O Zernio processa o OAuth inteiro sozinho (o
// redirect_uri que o Instagram chama é do PRÓPRIO Zernio, não nosso) e, ao
// final, redireciona o navegador para a URL que passarmos em `redirectUrl`
// — parâmetro não documentado publicamente na doc do Zernio, mas confirmado
// funcional em teste real (2026-08-03): fica embutido no `state` deles e é
// para onde o usuário volta depois de autorizar. Isso permite manter o
// mesmo fluxo popup+postMessage que as outras redes já usam.

router.get('/instagram', requireAuth, async (req, res) => {
  const configError = checkEnv(['ZERNIO_API_KEY', 'ZERNIO_PROFILE_ID'], 'instagram');
  if (configError) return res.status(400).json(configError);

  const { accountName } = req.query;
  const platform = 'instagram';
  const state = signState({ accountName, platform, userId: req.user.id });
  const redirectUrl = `${(process.env.BASE_URL || '').replace(/\/$/, '')}/auth/instagram/zernio-return?state=${encodeURIComponent(state)}`;

  try {
    const { authUrl } = await zernioClient.connectUrl(platform, process.env.ZERNIO_PROFILE_ID, redirectUrl);
    addLog('info', `OAuth Instagram (via Zernio) iniciado para "${accountName}"`, platform, null, req.user.id);
    res.json({ authUrl });
  } catch (err) {
    addLog('err', `Falha ao iniciar OAuth Instagram via Zernio: ${err.message}`, platform, null, req.user.id);
    res.status(502).json({ error: 'Não foi possível iniciar a conexão com o Instagram no momento.' });
  }
});

router.get('/instagram/zernio-return', async (req, res) => {
  const { state } = req.query;

  let meta = {};
  try { meta = verifyState(state); } catch {}

  const platform = 'instagram';

  if (!meta.userId) {
    addLog('err', 'Falha no retorno do Zernio (Instagram): state inválido ou sem usuário associado', platform);
    return res.send(popupError('oauth_failed'));
  }

  try {
    const conta = await syncZernioAccount(platform, meta.userId, meta.accountName);
    addLog('ok', `Conta Instagram conectada via Zernio: "${conta.handle}"`, platform, conta.id, meta.userId);
    res.send(popupSuccess());
  } catch (err) {
    addLog('err', `Falha ao sincronizar conta Instagram do Zernio: ${err.message}`, platform, null, meta.userId);
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
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    // Necessário para o primeiro comentário automático (commentThreads.insert)
    // — escopo sensível, contas conectadas antes deste scope existir
    // precisam ser reconectadas. Ver infra/social/youtubePublisher.js (comentarYoutube).
    'https://www.googleapis.com/auth/youtube.force-ssl'
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

// TikTok agora conecta via Zernio (docs.zernio.com), mesmo padrão de
// Facebook/Instagram — sem PKCE nosso (iniciarOAuthTiktok/salvarPkceVerifier/
// consumirPkceVerifier ficam como código morto, não removido ainda). Isso
// também elimina o mecanismo que já causou um crash-loop histórico (INSERT
// duplicado de PKCE em oauth_pkce_state ao reconectar).
router.get('/tiktok', requireAuth, async (req, res) => {
  const configError = checkEnv(['ZERNIO_API_KEY', 'ZERNIO_PROFILE_ID'], 'tiktok');
  if (configError) return res.status(400).json(configError);

  const { accountName } = req.query;
  const platform = 'tiktok';
  const state = signState({ accountName, platform, userId: req.user.id });
  const redirectUrl = `${(process.env.BASE_URL || '').replace(/\/$/, '')}/auth/tiktok/zernio-return?state=${encodeURIComponent(state)}`;

  try {
    const { authUrl } = await zernioClient.connectUrl(platform, process.env.ZERNIO_PROFILE_ID, redirectUrl);
    addLog('info', `OAuth TikTok (via Zernio) iniciado para "${accountName}"`, platform, null, req.user.id);
    res.json({ authUrl });
  } catch (err) {
    addLog('err', `Falha ao iniciar OAuth TikTok via Zernio: ${err.message}`, platform, null, req.user.id);
    res.status(502).json({ error: 'Não foi possível iniciar a conexão com o TikTok no momento.' });
  }
});

router.get('/tiktok/zernio-return', async (req, res) => {
  const { state } = req.query;

  let meta = {};
  try { meta = verifyState(state); } catch {}

  const platform = 'tiktok';

  if (!meta.userId) {
    addLog('err', 'Falha no retorno do Zernio (TikTok): state inválido ou sem usuário associado', platform);
    return res.send(popupError('oauth_failed'));
  }

  try {
    const conta = await syncZernioAccount(platform, meta.userId, meta.accountName);
    addLog('ok', `Conta TikTok conectada via Zernio: "${conta.handle}"`, platform, conta.id, meta.userId);
    res.send(popupSuccess());
  } catch (err) {
    addLog('err', `Falha ao sincronizar conta TikTok do Zernio: ${err.message}`, platform, null, meta.userId);
    res.send(popupError('oauth_failed'));
  }
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
    let tiktokOpenId = null;
    try {
      // open_id identifica o usuário de forma estável entre chamadas — é o
      // mesmo valor que vem em user_openid no webhook de revogação de
      // autorização (authorization.removed), permitindo achar a conta certa
      // sem precisar guardar o access_token pra sempre. Ver /tiktok/webhook.
      const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,avatar_url', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const profileData = await profileRes.json();
      tiktokUsername = profileData?.data?.user?.username;
      tiktokAvatarUrl = profileData?.data?.user?.avatar_url || null;
      tiktokOpenId = profileData?.data?.user?.open_id || null;
      if (!accountName) accountName = tiktokUsername || profileData?.data?.user?.display_name;
    } catch {}
    accountName = accountName || 'Nova Conta TikTok';

    const conta = await contasRepo.criarContaRapida({
      name: accountName,
      platform: 'tiktok',
      userId: meta.userId,
      avatarUrl: tiktokAvatarUrl,
      externalUserId: tiktokOpenId
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

// Quando o usuário revoga a autorização do app pelo próprio app do TikTok
// (fora do nosso fluxo), o token continua no banco como "válido" até a
// próxima tentativa de uso falhar — marcamos como 'error' assim que o evento
// chega, para que a conta apareça imediatamente como precisando de reconexão
// no painel (mesmo status usado quando uma renovação de token falha, ver
// tokensRepository.js), em vez de só descobrir isso na próxima publicação.
async function processarRevogacaoTiktok(openId) {
  if (!openId) return
  const contas = await contasRepo.buscarContasPorExternalUserId('tiktok', openId)
  for (const conta of contas) {
    await pool.query(`UPDATE tokens SET status = 'error', atualizado_em = NOW() WHERE conta_id = $1 AND platform = 'tiktok'`, [conta.id])
    addLog('warn', `Autorização do TikTok revogada pelo usuário — conta marcada como desconectada`, 'tiktok', conta.id, conta.userId)
  }
}

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

  const event = req.body?.event || 'evento desconhecido';
  addLog('info', `Webhook TikTok recebido: ${event}`, 'tiktok');

  // Responde 200 imediatamente (o TikTok espera confirmação rápida) e trata o
  // evento em background — mesmo padrão do Data Deletion Callback da Meta.
  res.status(200).json({ received: true });

  if (event === 'authorization.removed') {
    const openId = req.body?.user_openid || req.body?.content?.user_openid;
    processarRevogacaoTiktok(openId).catch(err => addLog('err', `Falha ao processar revogação TikTok: ${err.message}`, 'tiktok'));
  }
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

  const sigBuf = Buffer.from(encodedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Assinatura do signed_request inválida');
  }

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
    // O signed_request identifica o usuário pelo Facebook User ID. Instagram
    // usa um user_id diferente (do próprio Instagram Graph API, via Instagram
    // Login), por isso não entra aqui.
    for (const platform of ['facebook']) {
      processarExclusaoDados(platform, payload.user_id).catch(err => {
        addLog('err', `Falha ao processar Data Deletion Callback [${platform}]: ${err.message}`, platform);
      });
    }

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
