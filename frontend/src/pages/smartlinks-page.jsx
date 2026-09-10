import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'

function parseLinkLine(line) {
  const value = line.trim()
  if (!value) return null
  const separator = value.indexOf('|')
  if (separator >= 0) return { label: value.slice(0, separator).trim(), url: value.slice(separator + 1).trim() }
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && url.hostname) return { label: url.hostname.replace(/^www\./i, ''), url: url.toString() }
  } catch {}
  return { label: '', url: value }
}

const emptyForm = { name: '', slug: '', title: '', description: '', links: '', logoUrl: '' }
const previewSlug = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'seu-link'

export function SmartlinksPage() {
  const [smartlinks, setSmartlinks] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingSlug, setEditingSlug] = useState('')
  const [savingSlug, setSavingSlug] = useState(false)
  const notify = useToast()
  const load = useCallback(() => apiFetch('/api/smartlinks').then(data => setSmartlinks(data.smartlinks || [])), [])

  useEffect(() => { load().catch(error => notify(error.message, 'error')) }, [load, notify])

  async function changeLogo(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return notify('Escolha uma imagem JPG, PNG, GIF ou WebP.', 'error')
    setUploadingLogo(true)
    try {
      const upload = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
      const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!response.ok) throw new Error('Não foi possível enviar a logo.')
      const uploaded = await response.json().catch(() => null)
      const mediaUrl = upload.mediaUrl || uploaded?.url
      if (!mediaUrl) throw new Error('O upload não retornou uma URL válida.')
      setForm(current => ({ ...current, logoUrl: mediaUrl }))
      notify('Logo da loja carregada.')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    try {
      const items = form.links.split('\n').map(parseLinkLine).filter(Boolean)
      await apiFetch('/api/smartlinks', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          title: form.title,
          description: form.description,
          theme: { logoUrl: form.logoUrl || null },
          items,
        }),
      })
      setForm(emptyForm)
      await load()
      notify('Smartlink criado.')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function remove(id) {
    if (!window.confirm('Excluir este Smartlink?')) return
    try {
      await apiFetch(`/api/smartlinks/${id}`, { method: 'DELETE' })
      setSmartlinks(current => current.filter(item => item.id !== id))
      notify('Smartlink removido.')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  function startSlugEdit(link) {
    setEditingId(link.id)
    setEditingSlug(link.slug || '')
  }

  async function saveSlug(id) {
    setSavingSlug(true)
    try {
      const updated = await apiFetch(`/api/smartlinks/${id}`, { method: 'PATCH', body: JSON.stringify({ slug: editingSlug }) })
      setSmartlinks(current => current.map(link => link.id === id ? { ...link, slug: updated.slug } : link))
      setEditingId(null)
      notify('URL personalizada atualizada.')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setSavingSlug(false)
    }
  }

  return (
    <section className="page-view">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">CONVERSÃO · LINK NA BIO</p>
          <h2>Smartlinks</h2>
          <p className="panel-subtitle">Crie uma página personalizada para reunir Instagram, WhatsApp, site, YouTube, cursos e produtos.</p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form className="panel space-y-4" onSubmit={save}>
          <div>
            <p className="eyebrow">NOVO SMARTLINK</p>
            <h3 className="text-lg font-semibold text-zinc-100">Sua central de links</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">A logo da loja ficará centralizada na página pública, enquanto a marca Meu Ecoo aparece no canto.</p>
          </div>

          <div className="smartlink-logo-field">
            <div className="smartlink-logo-preview">
              {form.logoUrl ? <img src={form.logoUrl} alt="Prévia da logo da loja" /> : <span aria-hidden="true">＋</span>}
            </div>
            <div>
              <strong className="block text-sm text-zinc-200">Logo da loja</strong>
              <p className="mt-1 text-xs leading-5 text-zinc-500">PNG, JPG, GIF ou WebP. Ela será exibida no centro da página.</p>
              <label className="secondary-button smartlink-upload-button mt-2">
                {uploadingLogo ? 'Enviando…' : form.logoUrl ? 'Trocar logo' : 'Adicionar logo'}
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={changeLogo} disabled={uploadingLogo} />
              </label>
              {form.logoUrl && <button type="button" className="link-button danger-link ml-3" onClick={() => setForm(current => ({ ...current, logoUrl: '' }))}>Remover</button>}
            </div>
          </div>

          <label className="block text-sm text-zinc-300">Nome interno<input className="mt-1 w-full rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Perfil principal" required /></label>
          <label className="block text-sm text-zinc-300">URL personalizada <small className="text-zinc-500">opcional</small><div className="mt-1 flex items-center rounded-lg border border-subtle bg-app"><span className="pl-3 text-sm text-zinc-500">/go/</span><input className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none" value={form.slug} onChange={event => setForm(current => ({ ...current, slug: event.target.value }))} placeholder="breno-augusto" maxLength="60" /></div><small className="mt-1 block text-xs leading-5 text-zinc-500">Use letras, números e hífens.</small><small className="mt-1 block truncate text-xs text-gold">Sua URL: {window.location.origin}/go/{previewSlug(form.slug || form.name)}</small></label>
          <label className="block text-sm text-zinc-300">Título público<input className="mt-1 w-full rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="Nome da loja" /></label>
          <label className="block text-sm text-zinc-300">Descrição<textarea className="mt-1 w-full rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="Uma frase sobre a loja ou sua marca" /></label>
          <label className="block text-sm text-zinc-300">Links <small className="text-zinc-500">uma URL por linha ou texto | https://endereco.com</small><textarea className="mt-1 min-h-36 w-full rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.links} onChange={event => setForm(current => ({ ...current, links: event.target.value }))} placeholder={'https://exemplo.com\nInstagram | https://instagram.com/'} required /></label>
          <p className="-mt-2 text-xs leading-5 text-zinc-500">Exemplo: Instagram, WhatsApp, página de vendas e YouTube podem ficar todos no mesmo Smartlink.</p>
          <button type="submit" className="action-button" disabled={uploadingLogo}>Criar Smartlink</button>
        </form>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PÁGINAS PUBLICADAS</p>
              <h3>Seus Smartlinks</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">Abra a página pública para conferir a logo centralizada e o selo Meu Ecoo no canto.</p>
            </div>
            <span className="status-badge">{smartlinks.length}</span>
          </div>
          {smartlinks.length ? <div className="space-y-3">{smartlinks.map(link => <article className="rounded-xl border border-subtle bg-app p-4" key={link.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0">{link.theme?.logoUrl && <img className="smartlink-list-logo" src={link.theme.logoUrl} alt="" />}<strong className="text-zinc-100">{link.title || link.name}</strong>{editingId === link.id ? <div className="mt-2 flex max-w-md items-center rounded-lg border border-subtle bg-surface"><span className="pl-3 text-sm text-zinc-500">/go/</span><input aria-label={`URL personalizada de ${link.title || link.name}`} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none" value={editingSlug} onChange={event => setEditingSlug(event.target.value)} maxLength="60" autoFocus /><button className="px-3 py-2 text-xs font-semibold text-gold" type="button" onClick={() => saveSlug(link.id)} disabled={savingSlug}>{savingSlug ? 'Salvando…' : 'Salvar'}</button></div> : <p className="mt-1 truncate text-sm text-zinc-400">/go/{link.slug} · {link.items?.length || 0} links</p>}<div className="mt-2 flex flex-wrap gap-2">{(link.items || []).map(item => <span className="rounded-full bg-gold/10 px-2 py-1 text-xs text-gold" key={item.id}>{item.label} · {item.clicks || 0} cliques</span>)}</div></div><div className="flex shrink-0 gap-3"><button className="link-button" type="button" onClick={() => editingId === link.id ? setEditingId(null) : startSlugEdit(link)}>{editingId === link.id ? 'Cancelar' : 'Editar URL'}</button><button className="link-button danger-link" type="button" onClick={() => remove(link.id)}>Excluir</button></div></div><a className="mt-3 inline-block text-sm text-gold hover:underline" href={`/go/${link.slug}`} target="_blank" rel="noreferrer">Abrir página pública →</a></article>)}</div> : <p className="empty-state">Crie sua primeira página de links para divulgar todos os seus canais em um só lugar.</p>}
        </section>
      </div>
    </section>
  )
}
