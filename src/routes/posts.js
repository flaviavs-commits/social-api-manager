const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { addLog } = require('../middleware/logger');

// GET /api/posts — lista posts agendados
router.get('/', (req, res) => {
  const { status, platform } = req.query;
  let posts = db.get('posts').value();

  if (status) posts = posts.filter(p => p.status === status);
  if (platform) posts = posts.filter(p => p.platforms.includes(platform));

  // Ordenar por data de agendamento
  posts.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  res.json({ posts, total: posts.length });
});

// POST /api/posts — agendar novo post
router.post('/', (req, res) => {
  const { text, platforms, group, scheduledAt, repeat } = req.body;

  if (!text) return res.status(400).json({ error: 'text é obrigatório' });
  if (!platforms || platforms.length === 0) return res.status(400).json({ error: 'selecione ao menos uma plataforma' });
  if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt é obrigatório' });

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'scheduledAt inválido' });
  if (scheduledDate < new Date()) return res.status(400).json({ error: 'Data deve ser no futuro' });

  const post = {
    id: 'post_' + Date.now(),
    text,
    platforms,
    group: group || 'Todas',
    scheduledAt: scheduledDate.toISOString(),
    repeat: repeat || 'none',
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    publishedAt: null,
    results: []
  };

  db.get('posts').push(post).write();
  addLog('info', `Post agendado para ${scheduledDate.toLocaleString('pt-BR')} em ${platforms.join(', ')}`);
  res.status(201).json({ post });
});

// DELETE /api/posts/:id — cancelar post agendado
router.delete('/:id', (req, res) => {
  const post = db.get('posts').find({ id: req.params.id }).value();
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (post.status === 'published') return res.status(400).json({ error: 'Post já publicado' });

  db.get('posts').remove({ id: req.params.id }).write();
  addLog('warn', `Post cancelado: "${post.text.slice(0, 40)}..." [${post.platforms.join(', ')}]`);
  res.json({ success: true });
});

// POST /api/posts/:id/publish-now — publicar imediatamente
router.post('/:id/publish-now', async (req, res) => {
  const post = db.get('posts').find({ id: req.params.id }).value();
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const results = await publishPost(post);
  db.get('posts').find({ id: req.params.id }).assign({
    status: 'published',
    publishedAt: new Date().toISOString(),
    results
  }).write();

  res.json({ success: true, results });
});

// Função central de publicação (chamada pelo scheduler também)
async function publishPost(post) {
  const results = [];
  const tokens = db.get('tokens').value();
  const accounts = db.get('accounts').value();

  for (const platform of post.platforms) {
    const platformAccounts = accounts.filter(a => a.platform === platform && a.status === 'active');
    const group = post.group;

    // Filtrar contas pelo grupo
    const targetAccounts = group === 'Todas'
      ? platformAccounts
      : platformAccounts.filter(a => a.group === group);

    for (const account of targetAccounts) {
      const token = tokens.find(t => t.accountId === account.id && t.status === 'valid');

      if (!token) {
        addLog('warn', `Sem token válido para "${account.name}" — post ignorado`, platform, account.id);
        results.push({ accountId: account.id, accountName: account.name, platform, success: false, error: 'no_valid_token' });
        continue;
      }

      try {
        // Em produção: chamada real à API de cada plataforma
        await simulateApiCall(platform, post, token);
        addLog('ok', `POST publicado → "${account.name}" [${platform}]`, platform, account.id);
        results.push({ accountId: account.id, accountName: account.name, platform, success: true });
      } catch (err) {
        addLog('err', `Falha ao publicar em "${account.name}" [${platform}]: ${err.message}`, platform, account.id);
        results.push({ accountId: account.id, accountName: account.name, platform, success: false, error: err.message });
      }
    }
  }

  return results;
}

// Simula a chamada à API com delay realista
function simulateApiCall(platform, post, token) {
  return new Promise((resolve, reject) => {
    const delay = 200 + Math.random() * 600;
    setTimeout(() => {
      // Simula 5% de falha aleatória
      if (Math.random() < 0.05) {
        reject(new Error('Rate limit exceeded'));
      } else {
        resolve({ id: 'post_' + Math.random().toString(36).slice(2, 10) });
      }
    }, delay);
  });
}

module.exports = router;
module.exports.publishPost = publishPost;
