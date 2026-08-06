import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { useToast } from '../components/ui/toast.jsx'

const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }

function mediaItemsOf(draft) {
  if (Array.isArray(draft.mediaItems) && draft.mediaItems.length) return draft.mediaItems
  if (Array.isArray(draft.media_items) && draft.media_items.length) return draft.media_items
  return draft.mediaPath || draft.media_path ? [{ path: draft.mediaPath || draft.media_path, type: draft.mediaType || draft.media_type }] : []
}

function platformsOf(draft) {
  return Array.isArray(draft.platforms) ? draft.platforms.filter(Boolean) : []
}

function formatDraftDate(value) {
  if (!value) return 'Data não informada'
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function DraftMedia({ draft }) {
  const media = mediaItemsOf(draft)
  if (!media.length) return <div className="drafts-v2-media drafts-v2-media-empty"><span aria-hidden="true">✎</span><small>Somente texto</small></div>
  const first = media[0]
  const source = first.path || first.url || first.mediaUrl
  return <div className="drafts-v2-media">{source && (first.type === 'video' || first.type === 'VIDEO') ? <div className="drafts-v2-video"><span aria-hidden="true">▶</span><small>Vídeo</small></div> : source ? <img src={source} alt="Prévia do rascunho" /> : <span aria-hidden="true">▧</span>}{media.length > 1 && <b>+{media.length - 1}</b>}</div>
}

export function DraftsPage({ onNavigate }) {
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const load = useCallback(() => apiFetch('/api/drafts').then(data => data.drafts || []), [])
  const { value: drafts, loading, error, setError, reload } = useApiResource(load, [])
  const notify = useToast()

  const visibleDrafts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return drafts.filter(draft => {
      const isTemplate = Boolean(draft.is_template || draft.isTemplate)
      const content = `${draft.title || ''} ${draft.text || ''} ${platformsOf(draft).join(' ')}`.toLowerCase()
      return (!query || content.includes(query)) && (filter === 'all' || (filter === 'templates' ? isTemplate : !isTemplate))
    })
  }, [drafts, filter, search])

  async function save(event) {
    event.preventDefault()
    const content = text.trim()
    if (!content) return setError('Escreva algum conteúdo antes de salvar.')
    try { await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Rascunho', text: content, platforms: [] }) }); setText(''); await reload(); notify('Rascunho salvo.') }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
  }

  async function remove(id) {
    if (!window.confirm('Excluir este rascunho?')) return
    try { await apiFetch(`/api/drafts/${id}`, { method: 'DELETE' }); await reload(); notify('Rascunho excluído.') }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
  }

  function useDraft(draft) {
    const platforms = platformsOf(draft)
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({ text: draft.text || '', selected: platforms.length ? platforms : ['instagram'], publishNow: false, date: '', firstComment: draft.first_comment || draft.firstComment || '', textByPlatform: draft.text_by_platform || draft.textByPlatform || {}, savedAt: new Date().toISOString() }))
    notify('Conteúdo carregado no editor.')
    onNavigate?.('agendador')
  }

  const templatesCount = drafts.filter(draft => Boolean(draft.is_template || draft.isTemplate)).length
  const mediaCount = drafts.filter(draft => mediaItemsOf(draft).length > 0).length

  return <section className="page-view drafts-page drafts-page-v2">
    <header className="drafts-v2-heading"><div className="drafts-v2-heading-copy"><span className="drafts-v2-heading-icon" aria-hidden="true">✎</span><div><p className="eyebrow">BIBLIOTECA DE CONTEÚDO</p><h2>Rascunhos</h2><p>Guarde ideias, refine suas publicações e continue de onde parou.</p></div></div><button type="button" className="secondary-button drafts-v2-refresh" onClick={() => reload().catch(() => {})}><span aria-hidden="true">↻</span> Atualizar</button></header>
    <div className="drafts-v2-summary" aria-label="Resumo dos rascunhos"><article><span className="drafts-v2-stat-icon" aria-hidden="true">▤</span><div><span>Total de rascunhos</span><strong>{drafts.length}</strong><small>Conteúdos salvos</small></div></article><article><span className="drafts-v2-stat-icon is-purple" aria-hidden="true">◇</span><div><span>Modelos</span><strong>{templatesCount}</strong><small>Prontos para reutilizar</small></div></article><article><span className="drafts-v2-stat-icon is-green" aria-hidden="true">▧</span><div><span>Com mídia</span><strong>{mediaCount}</strong><small>Fotos ou vídeos anexados</small></div></article></div>
    <div className="drafts-v2-workspace">
      <section className="panel drafts-v2-editor-panel">
        <div className="drafts-v2-editor-heading"><div><p className="eyebrow">CRIAR AGORA</p><h3>Nova ideia</h3><p>Escreva um ponto de partida. Você poderá editar e publicar depois.</p></div><span className="drafts-v2-editor-icon" aria-hidden="true">✦</span></div>
        <form className="drafts-v2-form" onSubmit={save}>
          <label className="drafts-v2-text-field"><span>Conteúdo do rascunho</span><textarea value={text} onChange={event => setText(event.target.value)} placeholder="Comece a escrever sua próxima publicação..." aria-label="Texto do rascunho" maxLength={5000}/><span className="drafts-v2-editor-meta"><span>{text.length}/5000 caracteres</span><span>Salvo ao clicar no botão</span></span></label>
          <div className="drafts-v2-form-tip"><span aria-hidden="true">↗</span><span>Uma boa ideia não precisa estar completa para ser salva.</span></div>
          <button className="action-button drafts-v2-save-button" type="submit">Salvar rascunho <span aria-hidden="true">→</span></button>
        </form>
      </section>
      <section className="panel drafts-v2-list-panel">
        <div className="drafts-v2-list-heading"><div><p className="eyebrow">SEUS CONTEÚDOS</p><h3>Rascunhos salvos</h3></div><span className="drafts-v2-list-count">{visibleDrafts.length} {visibleDrafts.length === 1 ? 'item' : 'itens'}</span></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="drafts-v2-toolbar"><label className="drafts-v2-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por texto, título ou rede..." aria-label="Buscar rascunho" /></label><div className="drafts-v2-filter-tabs" role="tablist" aria-label="Filtrar rascunhos">{[['all', 'Todos'], ['drafts', 'Em andamento'], ['templates', 'Modelos']].map(([key, label]) => <button type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)} key={key}>{label}</button>)}</div></div>
        {loading ? <LoadingState>Carregando rascunhos...</LoadingState> : visibleDrafts.length ? <div className="drafts-v2-card-list">{visibleDrafts.map(draft => {
          const template = Boolean(draft.is_template || draft.isTemplate)
          const platforms = platformsOf(draft)
          return <article className="drafts-v2-card" key={draft.id}><DraftMedia draft={draft}/><div className="drafts-v2-card-body"><div className="drafts-v2-card-topline"><span className={`drafts-v2-type-badge${template ? ' is-template' : ''}`}>{template ? 'Modelo' : 'Rascunho'}</span><time>{formatDraftDate(draft.criado_em || draft.createdAt)}</time></div><h4>{draft.title || 'Rascunho sem título'}</h4><p>{draft.text || 'Sem texto adicionado ainda.'}</p><div className="drafts-v2-card-footer"><div className="drafts-v2-card-platforms" aria-label={platforms.length ? platforms.map(platform => PLATFORM_LABELS[platform] || platform).join(', ') : 'Nenhuma rede selecionada'}>{platforms.length ? platforms.map(platform => <span className={`drafts-v2-platform drafts-v2-platform-${platform}`} key={platform} title={PLATFORM_LABELS[platform] || platform}><PlatformIcon platform={platform} className="h-3.5 w-3.5" /></span>) : <small>Nenhuma rede selecionada</small>}</div><span className="drafts-v2-card-actions"><button type="button" className="link-button" onClick={() => useDraft(draft)}>{template ? 'Usar modelo' : 'Continuar editando'}</button><button type="button" className="link-button danger-link" onClick={() => remove(draft.id)}>Excluir</button></span></div></div></article>
        })}</div> : <div className="drafts-v2-empty"><span aria-hidden="true">✦</span><strong>{search || filter !== 'all' ? 'Nenhum rascunho encontrado' : 'Sua biblioteca está vazia'}</strong><p>{search || filter !== 'all' ? 'Tente mudar os filtros ou a busca.' : 'Salve uma ideia ao lado para começar sua biblioteca de conteúdo.'}</p>{(search || filter !== 'all') && <button type="button" className="link-button" onClick={() => { setSearch(''); setFilter('all') }}>Limpar filtros</button>}</div>}
      </section>
    </div>
  </section>
}
