// Helpers compartilhados pelos publishers para resolver a URL/binário de uma
// mídia de post, seja ela uma URL do Vercel Blob ou um path local legado.
const fs = require('fs')
const path = require('path')
const { gerarTokenMedia } = require('../storage/mediaToken')

const UPLOADS_DIR = path.join(__dirname, '../../../public/uploads')
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

// Mídias novas são salvas no Vercel Blob — mediaPath já vem como uma URL
// pública completa (https://...blob.vercel-storage.com/...). Mantém suporte a
// posts antigos ainda com path relativo (/uploads/...), criados antes da
// migração para o Blob, para não quebrar nada que já estivesse na fila no
// momento do deploy.
function isUrlExterna(mediaPath) {
  return /^https?:\/\//i.test(mediaPath)
}

async function mediaToBlob(mediaPath) {
  if (isUrlExterna(mediaPath)) {
    const res = await fetch(mediaPath)
    if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status}): ${mediaPath}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, filename: path.basename(new URL(mediaPath).pathname) }
  }

  const filename = path.basename(mediaPath)
  const absPath = path.join(UPLOADS_DIR, filename)
  const buffer = fs.readFileSync(absPath)
  return { buffer, filename, absPath }
}

// URL que Instagram/TikTok/etc usam para baixar a mídia diretamente. Mídias
// no Blob já têm URL pública própria — usa direto. Posts antigos com path
// relativo (/uploads/...) continuam usando o token assinado de curta duração,
// já que /uploads normalmente exige sessão e essas APIs não enviam cookie.
function mediaUrl(mediaPath) {
  if (isUrlExterna(mediaPath)) return mediaPath

  const filename = path.basename(mediaPath)
  const token = gerarTokenMedia(filename)
  return `${BASE_URL}${mediaPath}?token=${token}`
}

// O TikTok (pull_by_url) exige que a URL da mídia esteja num domínio
// verificado em "Verify domains" — mas o Blob usa um domínio próprio
// (*.public.blob.vercel-storage.com) que não temos como verificar (DNS de
// terceiro). Por isso, só para o TikTok, a URL do Blob passa por um proxy
// no nosso próprio domínio (já verificado), assinado por token de curta
// duração — as demais plataformas continuam usando a URL do Blob direto.
function mediaUrlTiktok(mediaPath) {
  if (!isUrlExterna(mediaPath)) return mediaUrl(mediaPath)

  // O TikTok valida o url_prefix de forma estrita: a URL precisa começar com
  // o prefixo verificado e (na prática) terminar num arquivo, sem query
  // string — URLs com ?params caem em url_ownership_unverified. Por isso a
  // URL do Blob vai codificada no próprio path (base64url), preservando a
  // extensão real no fim para o TikTok reconhecer o tipo de imagem.
  const token = gerarTokenMedia(mediaPath)
  const encoded = Buffer.from(mediaPath).toString('base64url')
  const ext = path.extname(new URL(mediaPath).pathname) || '.jpg'
  return `${BASE_URL}/media-proxy/${token}/${encoded}${ext}`
}

module.exports = { UPLOADS_DIR, isUrlExterna, mediaToBlob, mediaUrl, mediaUrlTiktok }
