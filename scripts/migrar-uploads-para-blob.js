// Migra os arquivos antigos em public/uploads (de antes da migração para o
// Vercel Blob) para o Blob, e atualiza media_path/media_items dos posts no
// banco com a nova URL — preserva o preview de fotos/vídeos publicados antes
// dessa migração, que hoje aparecem quebrados porque o disco onde estavam
// salvos não existe mais no ambiente serverless da Vercel.
//
// Uso: node scripts/migrar-uploads-para-blob.js [--dry-run]

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { put } = require('@vercel/blob')
const pool = require('../src/db/pool')

const UPLOADS_DIR = path.join(__dirname, '../public/uploads')
const dryRun = process.argv.includes('--dry-run')

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska'
}

async function uploadArquivoLocal(relPath, cache) {
  if (cache.has(relPath)) return cache.get(relPath)

  const filename = path.basename(relPath)
  const absPath = path.join(UPLOADS_DIR, filename)
  if (!fs.existsSync(absPath)) {
    console.warn(`  [pular] arquivo não encontrado localmente: ${relPath}`)
    cache.set(relPath, null)
    return null
  }

  const ext = path.extname(filename).toLowerCase()
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream'
  const buffer = fs.readFileSync(absPath)

  if (dryRun) {
    console.log(`  [dry-run] subiria ${relPath} (${buffer.length} bytes, ${mime})`)
    cache.set(relPath, `DRY-RUN-URL/${filename}`)
    return cache.get(relPath)
  }

  const { url } = await put(filename, buffer, { access: 'public', contentType: mime })
  console.log(`  [ok] ${relPath} -> ${url}`)
  cache.set(relPath, url)
  return url
}

async function main() {
  const { rows: posts } = await pool.query(`
    SELECT id, media_path, media_items
    FROM posts
    WHERE media_path LIKE '/uploads/%' OR media_items::text LIKE '%/uploads/%'
    ORDER BY id
  `)

  console.log(`Encontrados ${posts.length} posts com mídia em /uploads/...\n`)

  const cache = new Map() // /uploads/xxx.jpg -> URL do Blob (ou null se não achou o arquivo)
  let migrados = 0
  let pulados = 0

  for (const post of posts) {
    console.log(`Post #${post.id}:`)
    let novoMediaPath = post.media_path
    let novoMediaItems = post.media_items

    if (post.media_path?.startsWith('/uploads/')) {
      const url = await uploadArquivoLocal(post.media_path, cache)
      if (url) novoMediaPath = url
    }

    if (Array.isArray(post.media_items)) {
      novoMediaItems = await Promise.all(post.media_items.map(async item => {
        if (!item.path?.startsWith('/uploads/')) return item
        const url = await uploadArquivoLocal(item.path, cache)
        return url ? { ...item, path: url } : item
      }))
    }

    const mudouPath = novoMediaPath !== post.media_path
    const mudouItems = JSON.stringify(novoMediaItems) !== JSON.stringify(post.media_items)

    if (!mudouPath && !mudouItems) {
      console.log(`  nenhum arquivo local encontrado — mantendo como está\n`)
      pulados++
      continue
    }

    if (!dryRun) {
      await pool.query(
        `UPDATE posts SET media_path = $1, media_items = $2 WHERE id = $3`,
        [novoMediaPath, novoMediaItems ? JSON.stringify(novoMediaItems) : null, post.id]
      )
    }
    console.log(`  ${dryRun ? '[dry-run] atualizaria' : 'atualizado'} no banco\n`)
    migrados++
  }

  console.log(`\nResumo: ${migrados} posts migrados, ${pulados} sem arquivo local encontrado.`)
  if (dryRun) console.log('(modo --dry-run: nada foi alterado de fato)')

  await pool.end()
}

main().catch(err => {
  console.error('Erro na migração:', err)
  process.exit(1)
})
