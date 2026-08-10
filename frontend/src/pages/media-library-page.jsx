import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'

function formatSize(value) {
  const bytes = Number(value || 0)
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function MediaLibraryPage() {
  const [assets, setAssets] = useState([])
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const notify = useToast()
  const load = useCallback(() => apiFetch(`/api/media-assets?search=${encodeURIComponent(search)}&folder=${encodeURIComponent(folder)}`).then(data => setAssets(data.assets || [])), [folder, search])
  useEffect(() => { setLoading(true); load().catch(error => notify(error.message, 'error')).finally(() => setLoading(false)) }, [load, notify])

  async function upload(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const signed = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
        const response = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!response.ok) throw new Error(`Não foi possível enviar ${file.name}.`)
        const uploaded = await response.json().catch(() => null)
        if (!uploaded?.url) throw new Error(`O upload de ${file.name} não retornou uma URL.`)
        await apiFetch('/api/media-assets', { method: 'POST', body: JSON.stringify({ name: file.name, url: uploaded.url, mimeType: file.type, sizeBytes: file.size, folder: folder || 'Geral' }) })
      }
      await load()
      notify(`${files.length} mídia(s) adicionada(s) à biblioteca.`)
    } catch (error) { notify(error.message, 'error') } finally { setUploading(false) }
  }

  async function remove(asset) {
    if (!window.confirm(`Remover ${asset.name} da biblioteca?`)) return
    try { await apiFetch(`/api/media-assets/${asset.id}`, { method: 'DELETE' }); setAssets(current => current.filter(item => item.id !== asset.id)); notify('Mídia removida.') }
    catch (error) { notify(error.message, 'error') }
  }

  return <section className="page-view">
    <header className="panel-heading"><div><p className="eyebrow">BIBLIOTECA DE CONTEÚDO</p><h2>Biblioteca de mídia</h2><p className="panel-subtitle">Centralize fotos e vídeos para reutilizar em novos posts.</p></div><label className="action-button">{uploading ? 'Enviando…' : 'Adicionar mídia'}<input type="file" hidden multiple accept="image/*,video/*" onChange={upload} disabled={uploading}/></label></header>
    <section className="panel"><div className="flex flex-wrap items-center gap-3"><input className="min-w-[220px] flex-1 rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome ou tag…" aria-label="Buscar mídia"/><input className="w-44 rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={folder} onChange={event => setFolder(event.target.value)} placeholder="Pasta (opcional)" aria-label="Filtrar pasta"/></div>{loading ? <p className="empty-state">Carregando biblioteca…</p> : assets.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{assets.map(asset => <article className="overflow-hidden rounded-xl border border-subtle bg-app" key={asset.id}><div className="flex h-40 items-center justify-center bg-black/20">{asset.mimeType?.startsWith('video/') ? <video className="h-full w-full object-cover" src={asset.url} muted controls preload="metadata"/> : <img className="h-full w-full object-cover" src={asset.url} alt={asset.name}/>}</div><div className="p-3"><strong className="block truncate text-sm text-zinc-100" title={asset.name}>{asset.name}</strong><small className="mt-1 block text-zinc-500">{asset.folder}{asset.sizeBytes ? ` · ${formatSize(asset.sizeBytes)}` : ''}</small>{asset.tags?.length ? <div className="mt-2 flex flex-wrap gap-1">{asset.tags.map(tag => <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] text-gold" key={tag}>#{tag}</span>)}</div> : null}<button type="button" className="mt-3 text-xs text-red-400 hover:text-red-300" onClick={() => remove(asset)}>Remover da biblioteca</button></div></article>)}</div> : <div className="empty-state mt-5"><strong>Nenhuma mídia encontrada</strong><p>Adicione fotos ou vídeos para montar seu acervo reutilizável.</p></div>}</section>
  </section>
}
