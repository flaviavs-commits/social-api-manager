const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const adapter = new FileSync(path.join(dbDir, 'db.json'));
const db = low(adapter);

db.defaults({
  accounts: [],
  tokens: [],
  posts: [],
  logs: [],
  settings: {}
}).write();

// Seed com contas de exemplo se vazio
if (db.get('accounts').value().length === 0) {
  const seed = [
    { id: 'acc_001', name: 'Marca Principal BR', platform: 'facebook', group: 'Marca Principal', status: 'active', createdAt: new Date().toISOString() },
    { id: 'acc_002', name: 'Marca Principal SP', platform: 'instagram', group: 'Marca Principal', status: 'active', createdAt: new Date().toISOString() },
    { id: 'acc_003', name: 'Canal Oficial', platform: 'youtube', group: 'Marca Principal', status: 'error', createdAt: new Date().toISOString() },
    { id: 'acc_004', name: 'Regional RJ', platform: 'facebook', group: 'Regionais', status: 'active', createdAt: new Date().toISOString() },
    { id: 'acc_005', name: 'Regional MG', platform: 'instagram', group: 'Regionais', status: 'active', createdAt: new Date().toISOString() },
    { id: 'acc_006', name: 'Creator Account 01', platform: 'tiktok', group: 'Criadores', status: 'error', createdAt: new Date().toISOString() },
    { id: 'acc_007', name: 'Canal Produtos', platform: 'youtube', group: 'Produtos', status: 'active', createdAt: new Date().toISOString() },
  ];
  db.set('accounts', seed).write();
}

if (db.get('tokens').value().length === 0) {
  const now = Date.now();
  const day = 86400000;
  const seedTokens = [
    { id: 'tok_001', accountId: 'acc_001', platform: 'facebook', accessToken: 'EAABx_simulated_token_001', expiresAt: new Date(now + 30 * day).toISOString(), status: 'valid' },
    { id: 'tok_002', accountId: 'acc_002', platform: 'instagram', accessToken: 'IGQVJx_simulated_token_002', expiresAt: new Date(now + 5 * day).toISOString(), status: 'expiring' },
    { id: 'tok_003', accountId: 'acc_003', platform: 'youtube', accessToken: 'ya29_simulated_token_003', expiresAt: new Date(now - 2 * day).toISOString(), status: 'expired' },
    { id: 'tok_004', accountId: 'acc_004', platform: 'facebook', accessToken: 'EAABx_simulated_token_004', expiresAt: new Date(now + 60 * day).toISOString(), status: 'valid' },
    { id: 'tok_005', accountId: 'acc_005', platform: 'instagram', accessToken: 'IGQVJx_simulated_token_005', expiresAt: new Date(now + 45 * day).toISOString(), status: 'valid' },
    { id: 'tok_006', accountId: 'acc_006', platform: 'tiktok', accessToken: 'act_simulated_token_006', expiresAt: new Date(now - 1 * day).toISOString(), status: 'expired' },
    { id: 'tok_007', accountId: 'acc_007', platform: 'youtube', accessToken: 'ya29_simulated_token_007', expiresAt: new Date(now + 20 * day).toISOString(), status: 'valid' },
  ];
  db.set('tokens', seedTokens).write();
}

if (db.get('posts').value().length === 0) {
  const seedPosts = [
    { id: 'post_001', text: 'Lançamento coleção verão 🌞', platforms: ['facebook','instagram'], group: 'Marca Principal', scheduledAt: '2026-06-10T09:00:00.000Z', status: 'scheduled', createdAt: new Date().toISOString() },
    { id: 'post_002', text: 'Tutorial app — 3 passos', platforms: ['youtube','tiktok'], group: 'Todas', scheduledAt: '2026-06-11T14:00:00.000Z', status: 'scheduled', createdAt: new Date().toISOString() },
    { id: 'post_003', text: 'Post de engajamento semanal', platforms: ['facebook','instagram','youtube','tiktok'], group: 'Todas', scheduledAt: '2026-06-12T10:00:00.000Z', status: 'scheduled', createdAt: new Date().toISOString() },
  ];
  db.set('posts', seedPosts).write();
}

module.exports = db;
