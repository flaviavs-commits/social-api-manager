const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, serverError } = require('../utils/http')

const apiRouter = Router()
const publicRouter = Router()
const slugify = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `link-${Date.now()}`
const validUrl = value => /^https:\/\//i.test(String(value || ''))

apiRouter.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT s.id,s.name,s.slug,s.title,s.description,s.theme,s.active,s.criado_em AS "createdAt",COALESCE(json_agg(json_build_object('id',i.id,'label',i.label,'url',i.url,'position',i.position,'clicks',i.clicks) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM smartlinks s LEFT JOIN smartlink_items i ON i.smartlink_id=s.id WHERE s.user_id=$1 GROUP BY s.id ORDER BY s.criado_em DESC`, [req.user.id])
    res.json({ smartlinks: rows })
  } catch (err) { serverError(res, err) }
})

apiRouter.post('/', async (req, res) => {
  const client = await pool.connect()
  try {
    const { name, slug, title, description, items = [], theme = {} } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ erro: 'Informe um nome para o Smartlink.' })
    const validItems = Array.isArray(items) ? items.filter(item => item?.label?.trim() && validUrl(item.url)).slice(0, 30) : []
    if (!validItems.length) return res.status(400).json({ erro: 'Adicione ao menos um link HTTPS válido.' })
    const baseSlug = slugify(slug || name)
    const candidate = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
    await client.query('BEGIN')
    const { rows } = await client.query('INSERT INTO smartlinks (user_id,name,slug,title,description,theme) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,slug', [req.user.id, name.trim(), candidate, title?.trim() || name.trim(), description?.trim() || null, JSON.stringify(theme || {})])
    for (const [position, item] of validItems.entries()) await client.query('INSERT INTO smartlink_items (smartlink_id,label,url,position) VALUES ($1,$2,$3,$4)', [rows[0].id, item.label.trim(), item.url.trim(), position])
    await client.query('COMMIT')
    res.status(201).json({ id: rows[0].id, slug: rows[0].slug, publicUrl: `/go/${rows[0].slug}` })
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); serverError(res, err) } finally { client.release() }
})

apiRouter.delete('/:id', async (req, res) => {
  try { const id = parseId(req.params.id); if (!id) return res.status(400).json({ erro: 'id inválido' }); await pool.query('DELETE FROM smartlinks WHERE id=$1 AND user_id=$2', [id, req.user.id]); res.status(204).send() } catch (err) { serverError(res, err) }
})

async function getPublic(slug) {
  const { rows } = await pool.query(`SELECT s.name,s.slug,s.title,s.description,s.theme,s.active,i.id,i.label,i.url,i.position FROM smartlinks s LEFT JOIN smartlink_items i ON i.smartlink_id=s.id WHERE s.slug=$1 ORDER BY i.position`, [slug])
  if (!rows.length || !rows[0].active) return null
  return { ...rows[0], items: rows.filter(row => row.id).map(row => ({ id: row.id, label: row.label, url: row.url })) }
}
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

publicRouter.get('/:slug/:itemId', async (req, res) => {
  try { const id = parseId(req.params.itemId); const { rows } = await pool.query('SELECT url FROM smartlink_items i JOIN smartlinks s ON s.id=i.smartlink_id WHERE s.slug=$1 AND s.active=true AND i.id=$2', [req.params.slug, id]); if (!rows.length || !validUrl(rows[0].url)) return res.status(404).send('Link não encontrado'); await pool.query('UPDATE smartlink_items SET clicks=clicks+1 WHERE id=$1', [id]); res.redirect(rows[0].url) } catch { res.status(404).send('Link não encontrado') }
})
publicRouter.get('/:slug', async (req, res) => {
  try { const data = await getPublic(req.params.slug); if (!data) return res.status(404).send('Página não encontrada'); const links = data.items.map(item => `<a href="/go/${escapeHtml(data.slug)}/${item.id}" rel="nofollow noopener">${escapeHtml(item.label)}</a>`).join(''); res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(data.title)}</title><style>body{font-family:Arial,sans-serif;max-width:560px;margin:60px auto;padding:24px;text-align:center;background:#111;color:#f5f5f5}a{display:block;margin:14px 0;padding:16px;border-radius:12px;background:#d9ad5b;color:#111;text-decoration:none;font-weight:700}p{color:#aaa}</style></head><body><h1>${escapeHtml(data.title)}</h1><p>${escapeHtml(data.description)}</p>${links}</body></html>`) } catch { res.status(404).send('Página não encontrada') }
})

module.exports = { apiRouter, publicRouter }
