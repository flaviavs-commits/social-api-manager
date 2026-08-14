const { Router } = require('express')
const pool = require('../db/pool')
const { parseId, serverError } = require('../utils/http')

const apiRouter = Router()
const publicRouter = Router()
const SLUG_MAX_LENGTH = 60
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_SLUGS = new Set(['api', 'app', 'assets', 'auth', 'go', 'login', 'support', 'privacy-policy', 'terms-of-service', 'como-funciona', 'criar-conta'])
const slugify = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, SLUG_MAX_LENGTH)
const normalizeSlug = value => slugify(String(value || '').trim())
const slugError = slug => {
  if (!slug) return 'Informe uma URL personalizada.'
  if (slug.length < 3) return 'A URL personalizada precisa ter pelo menos 3 caracteres.'
  if (!SLUG_PATTERN.test(slug)) return 'Use apenas letras, números e hífens, sem espaços ou símbolos.'
  if (RESERVED_SLUGS.has(slug)) return 'Essa palavra é reservada pelo sistema. Escolha outra URL.'
  return null
}
const isUniqueViolation = error => error?.code === '23505'

async function isSlugAvailable(client, slug, ignoreId = null) {
  const smartlink = await client.query(
    ignoreId === null
      ? 'SELECT id FROM smartlinks WHERE slug=$1 LIMIT 1'
      : 'SELECT id FROM smartlinks WHERE slug=$1 AND id<>$2 LIMIT 1',
    ignoreId === null ? [slug] : [slug, ignoreId]
  )
  if (smartlink.rows.length) return false
  const alias = await client.query('SELECT smartlink_id FROM smartlink_slug_aliases WHERE slug=$1 LIMIT 1', [slug])
  return !alias.rows.length || (ignoreId !== null && alias.rows[0].smartlink_id === ignoreId)
}

async function uniqueGeneratedSlug(client, baseSlug) {
  const base = baseSlug || `link-${Date.now()}`
  if (!RESERVED_SLUGS.has(base) && await isSlugAvailable(client, base)) return base
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6)
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - 5)}-${suffix}`
    if (!RESERVED_SLUGS.has(candidate) && await isSlugAvailable(client, candidate)) return candidate
  }
  return `${base.slice(0, SLUG_MAX_LENGTH - 13)}-${Date.now().toString(36)}`
}
const normalizeUrl = value => {
  const candidate = String(value || '').trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return url.toString()
  } catch { return null }
}
const validUrl = value => Boolean(normalizeUrl(value))

apiRouter.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT s.id,s.name,s.slug,s.title,s.description,s.theme,s.active,s.criado_em AS "createdAt",COALESCE(json_agg(json_build_object('id',i.id,'label',i.label,'url',i.url,'position',i.position,'clicks',i.clicks) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM smartlinks s LEFT JOIN smartlink_items i ON i.smartlink_id=s.id WHERE s.user_id=$1 GROUP BY s.id ORDER BY s.criado_em DESC`, [req.user.id])
    res.json({ smartlinks: rows })
  } catch (err) { serverError(res, err) }
})

apiRouter.post('/', async (req, res) => {
  let client
  try {
    const { name, slug, title, description, items = [], theme = {} } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ erro: 'Informe um nome para o Smartlink.' })
    const validItems = Array.isArray(items) ? items.map(item => ({
      label: String(item?.label || '').trim(),
      url: normalizeUrl(item?.url),
    })).filter(item => item.label && item.url).slice(0, 30) : []
    if (!validItems.length) return res.status(400).json({ erro: 'Adicione ao menos um link HTTPS válido.' })
    client = await pool.connect()
    await client.query('BEGIN')
    const requestedSlug = String(slug || '').trim()
    let candidate
    if (requestedSlug) {
      candidate = normalizeSlug(requestedSlug)
      const error = slugError(candidate)
      if (error) { await client.query('ROLLBACK'); return res.status(400).json({ erro: error }) }
      if (!await isSlugAvailable(client, candidate)) { await client.query('ROLLBACK'); return res.status(409).json({ erro: 'Essa URL personalizada já está em uso.' }) }
    } else {
      candidate = await uniqueGeneratedSlug(client, normalizeSlug(name))
    }
    const { rows } = await client.query('INSERT INTO smartlinks (user_id,name,slug,title,description,theme) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,slug', [req.user.id, name.trim(), candidate, title?.trim() || name.trim(), description?.trim() || null, JSON.stringify(theme || {})])
    for (const [position, item] of validItems.entries()) await client.query('INSERT INTO smartlink_items (smartlink_id,label,url,position) VALUES ($1,$2,$3,$4)', [rows[0].id, item.label.trim(), item.url.trim(), position])
    await client.query('COMMIT')
    res.status(201).json({ id: rows[0].id, slug: rows[0].slug, publicUrl: `/go/${rows[0].slug}` })
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {})
    if (isUniqueViolation(err)) return res.status(409).json({ erro: 'Essa URL personalizada já está em uso.' })
    serverError(res, err)
  } finally { client?.release() }
})

apiRouter.patch('/:id', async (req, res) => {
  let client
  try {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ erro: 'id inválido' })
    const candidate = normalizeSlug(req.body?.slug)
    const error = slugError(candidate)
    if (error) return res.status(400).json({ erro: error })
    client = await pool.connect()
    await client.query('BEGIN')
    const current = await client.query('SELECT id,slug FROM smartlinks WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, req.user.id])
    if (!current.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Smartlink não encontrado.' }) }
    if (current.rows[0].slug === candidate) { await client.query('COMMIT'); return res.json({ id, slug: candidate, publicUrl: `/go/${candidate}` }) }
    if (!await isSlugAvailable(client, candidate, id)) { await client.query('ROLLBACK'); return res.status(409).json({ erro: 'Essa URL personalizada já está em uso.' }) }
    await client.query('INSERT INTO smartlink_slug_aliases (slug,smartlink_id) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING', [current.rows[0].slug, id])
    await client.query('UPDATE smartlinks SET slug=$1 WHERE id=$2 AND user_id=$3', [candidate, id, req.user.id])
    await client.query('COMMIT')
    res.json({ id, slug: candidate, publicUrl: `/go/${candidate}` })
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {})
    if (isUniqueViolation(err)) return res.status(409).json({ erro: 'Essa URL personalizada já está em uso.' })
    serverError(res, err)
  } finally { client?.release() }
})

apiRouter.delete('/:id', async (req, res) => {
  try { const id = parseId(req.params.id); if (!id) return res.status(400).json({ erro: 'id inválido' }); await pool.query('DELETE FROM smartlinks WHERE id=$1 AND user_id=$2', [id, req.user.id]); res.status(204).send() } catch (err) { serverError(res, err) }
})

async function getPublic(slug) {
  const { rows } = await pool.query(`SELECT s.name,s.slug,s.title,s.description,s.theme,s.active,a.slug AS "aliasSlug",i.id,i.label,i.url,i.position FROM smartlinks s LEFT JOIN smartlink_slug_aliases a ON a.smartlink_id=s.id AND a.slug=$1 LEFT JOIN smartlink_items i ON i.smartlink_id=s.id WHERE s.slug=$1 OR a.slug=$1 ORDER BY i.position`, [slug])
  if (!rows.length || !rows[0].active) return null
  return { ...rows[0], items: rows.filter(row => row.id).map(row => ({ id: row.id, label: row.label, url: row.url })) }
}
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

publicRouter.get('/:slug/:itemId', async (req, res) => {
  try { const id = parseId(req.params.itemId); const { rows } = await pool.query('SELECT url FROM smartlink_items i JOIN smartlinks s ON s.id=i.smartlink_id LEFT JOIN smartlink_slug_aliases a ON a.smartlink_id=s.id WHERE (s.slug=$1 OR a.slug=$1) AND s.active=true AND i.id=$2', [req.params.slug, id]); if (!rows.length || !validUrl(rows[0].url)) return res.status(404).send('Link não encontrado'); await pool.query('UPDATE smartlink_items SET clicks=clicks+1 WHERE id=$1', [id]); res.redirect(rows[0].url) } catch { res.status(404).send('Link não encontrado') }
})
publicRouter.get('/:slug', async (req, res) => {
  try {
    const data = await getPublic(req.params.slug)
    if (!data) return res.status(404).send('Página não encontrada')
    if (data.aliasSlug && data.aliasSlug !== data.slug) return res.redirect(301, `/go/${encodeURIComponent(data.slug)}`)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')

    const title = escapeHtml(data.title || data.name || 'Smartlink')
    const descriptionText = String(data.description || '').trim()
    const description = descriptionText && descriptionText.toLowerCase() !== String(data.title || data.name || '').trim().toLowerCase() ? `<p class="profile-description">${escapeHtml(descriptionText)}</p>` : ''
    const initial = escapeHtml((data.title || data.name || 'S').trim().charAt(0).toUpperCase())
    const storeLogo = validUrl(data.theme?.logoUrl) ? escapeHtml(data.theme.logoUrl) : ''
    const storeIdentity = storeLogo
      ? `<div class="store-logo"><img src="${storeLogo}" alt="Logo de ${title}"></div>`
      : `<div class="avatar" aria-hidden="true">${initial}</div>`
    const links = data.items.map(item => `<a class="smartlink-item" href="/go/${escapeHtml(data.slug)}/${item.id}" target="_blank" rel="nofollow noopener"><span class="item-icon" aria-hidden="true">↗</span><span class="item-label">${escapeHtml(item.label)}</span><span class="item-arrow" aria-hidden="true">→</span></a>`).join('')
    const countLabel = `${data.items.length} ${data.items.length === 1 ? 'destino' : 'destinos'}`

    res.type('html').send(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0d0d0f">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="apple-touch-icon" href="/icon-192.png">
    <title>${title}</title>
    <style>
      :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d0d0f;color:#f8f7f3}
      *{box-sizing:border-box}
      body{min-height:100vh;margin:0;display:grid;place-items:center;background:radial-gradient(circle at 8% 8%,rgba(213,166,77,.16),transparent 28%),radial-gradient(circle at 92% 86%,rgba(117,79,205,.13),transparent 30%),#09090b;padding:34px 16px}
      .page{position:relative;width:min(100%,680px);margin:0 auto;padding:28px 18px 22px;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:32px;background:rgba(16,16,19,.78);box-shadow:0 30px 100px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.08);backdrop-filter:blur(18px)}
      .page:before{content:"";position:absolute;z-index:0;inset:0;background:radial-gradient(circle at 50% 0%,rgba(225,188,109,.13),transparent 38%);pointer-events:none}
      .page > *{position:relative;z-index:1}
      .corner-brand{position:absolute;z-index:2;top:18px;right:20px;display:grid;width:42px;height:42px;place-items:center;border:1px solid rgba(225,188,109,.28);border-radius:14px;background:rgba(9,9,11,.52);box-shadow:0 8px 20px rgba(0,0,0,.2);backdrop-filter:blur(10px)}
      .corner-brand img{width:25px;height:25px;object-fit:contain}
      .profile{text-align:center;padding:26px 28px 24px}
      .store-logo{width:104px;height:104px;margin:0 auto 19px;display:grid;place-items:center;border:1px solid rgba(245,213,143,.75);border-radius:31px;background:rgba(255,255,255,.96);box-shadow:0 16px 38px rgba(191,145,57,.25),inset 0 1px rgba(255,255,255,.75);overflow:hidden}
      .store-logo img{width:100%;height:100%;object-fit:contain;padding:10px}
      .avatar{position:relative;width:82px;height:82px;margin:18px auto 19px;display:grid;place-items:center;border:1px solid rgba(245,213,143,.75);border-radius:27px;background:linear-gradient(145deg,#f0c978 0%,#a6742f 100%);box-shadow:0 16px 38px rgba(191,145,57,.25),inset 0 1px rgba(255,255,255,.45);color:#17130c;font-size:32px;font-weight:850;letter-spacing:-.08em}
      .avatar:after{content:"";position:absolute;right:-3px;bottom:-3px;width:17px;height:17px;border:4px solid #0d0d0f;border-radius:50%;background:#71c891}
      h1{margin:0;color:#fff;font-size:clamp(28px,6vw,40px);font-weight:800;letter-spacing:-.055em;line-height:1.08}
      .profile-description{max-width:470px;margin:13px auto 0;color:#aaa7a0;font-size:15px;line-height:1.65}
      .links-header{display:flex;align-items:center;justify-content:space-between;margin:0 28px 12px;color:#8d8a84;font-size:11px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
      .links-header span:last-child{color:#c9a15b;letter-spacing:0}
      .links{display:grid;gap:12px;margin:0 20px}
      .smartlink-item{display:flex;align-items:center;min-height:72px;gap:14px;padding:15px 17px;border:1px solid rgba(255,255,255,.11);border-radius:19px;background:linear-gradient(100deg,rgba(255,255,255,.085),rgba(255,255,255,.045));box-shadow:0 8px 24px rgba(0,0,0,.14),inset 0 1px rgba(255,255,255,.04);color:#f7f5ef;text-decoration:none;transition:transform .2s ease,border-color .2s ease,background .2s ease,box-shadow .2s ease}
      .smartlink-item:hover{transform:translateY(-2px;border-color:rgba(225,188,109,.75);background:rgba(225,188,109,.13);box-shadow:0 12px 28px rgba(0,0,0,.25)}
      .smartlink-item:focus-visible{outline:3px solid rgba(225,188,109,.8);outline-offset:3px}
      .item-icon{display:grid;place-items:center;flex:0 0 38px;width:38px;height:38px;border-radius:12px;background:rgba(225,188,109,.16);color:#e6bf75;font-size:21px;font-weight:700}
      .item-label{flex:1;text-align:left;font-size:15px;font-weight:650;line-height:1.35;overflow-wrap:anywhere}
      .item-arrow{color:#dcb56b;font-size:22px;transition:transform .2s ease}
      .smartlink-item:hover .item-arrow{transform:translateX(3px)}
      .footer{display:block!important;width:100%!important;margin:22px 0 2px;color:#777570;font-size:12px;text-align:center!important;white-space:nowrap}
      .footer strong{display:inline-block;margin-left:6px;color:#aaa59b;font-weight:700}
      @media (max-width:420px){body{padding:18px 10px}.page{padding:24px 8px 18px;border-radius:26px}.corner-brand{top:14px;right:14px;width:38px;height:38px}.corner-brand img{width:22px;height:22px}.profile{padding:30px 14px 20px}.store-logo{width:88px;height:88px;border-radius:25px}.avatar{width:72px;height:72px;border-radius:23px;font-size:28px}.links-header{margin-left:10px;margin-right:10px}.links{margin-left:0;margin-right:0}.smartlink-item{min-height:66px;padding:12px 14px;border-radius:16px}}
      @media (prefers-reduced-motion:reduce){.smartlink-item,.item-arrow{transition:none}}
    </style>
  </head>
  <body>
    <main class="page">
      <a class="corner-brand" href="/" aria-label="Meu Ecoo Mídia"><img src="/logo-icon.png" alt="Meu Ecoo"></a>
      <header class="profile">
        ${storeIdentity}
        <h1>${title}</h1>
        ${description}
      </header>
      <div class="links-header"><span>Destinos</span><span>${countLabel}</span></div>
      <nav class="links" aria-label="Links de ${title}">
        ${links}
      </nav>
      <footer class="footer" style="display:block;width:100%;text-align:center">Criado com<strong>Meu Ecoo Mídia</strong></footer>
    </main>
  </body>
</html>`)
  } catch { res.status(404).send('Página não encontrada') }
})

module.exports = { apiRouter, publicRouter }
