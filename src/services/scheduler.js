const cron = require('node-cron');
const db = require('../db/database');
const { addLog } = require('../middleware/logger');
const { publishPost } = require('../routes/posts');

function startScheduler() {
  addLog('info', 'Scheduler iniciado');

  // ── A cada minuto: verificar posts agendados para publicar ─────────────────
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const posts = db.get('posts')
      .filter(p => p.status === 'scheduled' && new Date(p.scheduledAt) <= now)
      .value();

    for (const post of posts) {
      addLog('info', `Publicando post agendado: "${post.text.slice(0, 40)}..." [${post.platforms.join(', ')}]`);
      try {
        const results = await publishPost(post);
        const allOk = results.every(r => r.success);
        db.get('posts').find({ id: post.id }).assign({
          status: allOk ? 'published' : 'partial',
          publishedAt: new Date().toISOString(),
          results
        }).write();

        // Se tem repetição, agendar próximo
        if (post.repeat && post.repeat !== 'none') {
          scheduleNextRepeat(post);
        }

        addLog('ok', `Post publicado em ${results.filter(r=>r.success).length}/${results.length} contas`);
      } catch (err) {
        db.get('posts').find({ id: post.id }).assign({ status: 'error', error: err.message }).write();
        addLog('err', `Falha ao publicar post: ${err.message}`);
      }
    }
  });

  // ── A cada hora: verificar tokens expirando e renovar automaticamente ──────
  cron.schedule('0 * * * *', async () => {
    const now = Date.now();
    const sevenDays = 7 * 86400000;
    const tokens = db.get('tokens').value();

    for (const token of tokens) {
      const expiry = new Date(token.expiresAt).getTime();

      // Marcar como expirando
      if (expiry > now && expiry - now < sevenDays && token.status === 'valid') {
        db.get('tokens').find({ id: token.id }).assign({ status: 'expiring' }).write();
        const account = db.get('accounts').find({ id: token.accountId }).value();
        addLog('warn', `Token expira em breve: "${account?.name}" [${token.platform}]`, token.platform, token.accountId);
      }

      // Marcar como expirado
      if (expiry < now && token.status !== 'expired') {
        db.get('tokens').find({ id: token.id }).assign({ status: 'expired' }).write();
        const account = db.get('accounts').find({ id: token.accountId }).value();
        addLog('err', `Token expirado: "${account?.name}" [${token.platform}]`, token.platform, token.accountId);
        if (account) {
          db.get('accounts').find({ id: account.id }).assign({ status: 'error' }).write();
        }
      }

      // Renovar YouTube automaticamente se tiver refresh_token
      if (token.platform === 'youtube' && token.refreshToken && expiry - now < 300000) {
        try {
          const newExpiry = new Date(now + 3600000).toISOString();
          db.get('tokens').find({ id: token.id }).assign({
            expiresAt: newExpiry,
            status: 'valid',
            renewedAt: new Date().toISOString()
          }).write();
          const account = db.get('accounts').find({ id: token.accountId }).value();
          addLog('ok', `Token YouTube renovado automaticamente: "${account?.name}"`, 'youtube', token.accountId);
        } catch (err) {
          addLog('err', `Falha ao renovar token YouTube: ${err.message}`, 'youtube', token.accountId);
        }
      }
    }
  });

  // ── Todo dia à meia-noite: log de status geral ─────────────────────────────
  cron.schedule('0 0 * * *', () => {
    const accounts = db.get('accounts').value();
    const tokens = db.get('tokens').value();
    const posts = db.get('posts').filter(p => p.status === 'scheduled').value();
    addLog('info', `Status diário: ${accounts.length} contas | ${tokens.filter(t=>t.status==='valid').length} tokens válidos | ${posts.length} posts agendados`);
  });

  addLog('ok', 'Scheduler ativo — verificando posts a cada minuto, tokens a cada hora');
}

function scheduleNextRepeat(post) {
  const current = new Date(post.scheduledAt);
  let next;

  switch (post.repeat) {
    case 'daily':   next = new Date(current.getTime() + 86400000); break;
    case 'weekly':  next = new Date(current.getTime() + 7 * 86400000); break;
    case 'monthly': next = new Date(current); next.setMonth(next.getMonth() + 1); break;
    default: return;
  }

  const newPost = {
    ...post,
    id: 'post_' + Date.now(),
    scheduledAt: next.toISOString(),
    status: 'scheduled',
    publishedAt: null,
    results: [],
    createdAt: new Date().toISOString()
  };

  db.get('posts').push(newPost).write();
  addLog('info', `Próxima repetição agendada: "${post.text.slice(0,30)}..." → ${next.toLocaleString('pt-BR')}`);
}

module.exports = { startScheduler };
