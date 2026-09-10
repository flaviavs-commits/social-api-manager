import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { useApiResource } from '../hooks/use-api-resource.js'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { useToast } from '../components/ui/toast.jsx'

const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const AI_GENERATION_TIMEOUT_MS = 60_000
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }

function mediaItemsOf(draft) {
  if (Array.isArray(draft.mediaItems) && draft.mediaItems.length) return draft.mediaItems
  if (Array.isArray(draft.media_items) && draft.media_items.length) return draft.media_items
  return draft.mediaPath || draft.media_path ? [{ path: draft.mediaPath || draft.media_path, type: draft.mediaType || draft.media_type }] : []
}

function platformsOf(draft) {
  return Array.isArray(draft.platforms) ? draft.platforms.filter(Boolean) : []
}

function objectField(value) {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function textOf(draft) {
  if (draft.text?.trim()) return draft.text.trim()
  const textByPlatform = objectField(draft.text_by_platform || draft.textByPlatform)
  return Object.values(textByPlatform).filter(value => typeof value === 'string' && value.trim()).join('\n\n')
}

function inferredPlatformsOf(draft) {
  const selected = platformsOf(draft)
  if (selected.length) return selected
  const textByPlatform = objectField(draft.text_by_platform || draft.textByPlatform)
  const keys = Object.keys(textByPlatform)
  return keys.filter(key => PLATFORM_LABELS[key] || key === 'tiktokDescription').map(key => key === 'tiktokDescription' ? 'tiktok' : key)
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
  const [generating, setGenerating] = useState(false)
  const [expandedDraftId, setExpandedDraftId] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const load = useCallback(() => apiFetch('/api/drafts').then(data => data.drafts || []), [])
  const { value: drafts, loading, error, setError, reload } = useApiResource(load, [])
  const notify = useToast()

  const visibleDrafts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return drafts.filter(draft => {
      const isTemplate = Boolean(draft.is_template || draft.isTemplate)
      const content = `${draft.title || ''} ${textOf(draft)} ${inferredPlatformsOf(draft).join(' ')}`.toLowerCase()
      return (!query || content.includes(query)) && (filter === 'all' || (filter === 'templates' ? isTemplate : !isTemplate))
    })
  }, [drafts, filter, search])

  async function generateIdeas(event) {
    event.preventDefault()
    const content = text.trim()
    if (!content) return setError('Escreva um tema ou instrução para o sistema inteligente gerar ideias.')
    setGenerating(true)
    setError('')
    try {
      // Este é o mesmo contrato usado pelo Meu Post: mesmo endpoint,
      // fallback de modelo e regras de adaptação por plataforma.
      const generated = await apiFetch('/api/ai/generate', {
        method: 'POST',
        timeoutMs: AI_GENERATION_TIMEOUT_MS,
        body: JSON.stringify({ instrucao: content, plataformas: ['instagram'], quantidade: 3, tom: 'profissional' }),
      })
      const ideas = (generated.posts || [])
        .map(post => ({
          title: post.titulo || post.title || `Ideia sobre ${content.slice(0, 48)}${content.length > 48 ? '…' : ''}`,
          text: String(post.texto || post.text || post.caption || ''),
          platforms: Array.isArray(post.plataformas) && post.plataformas.length ? post.plataformas : ['instagram'],
        }))
        .filter(idea => idea.text.trim())
      if (!ideas.length) throw new Error('O sistema inteligente não retornou nenhuma ideia válida. Tente reformular o tema.')
      await Promise.all(ideas.map(idea => apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify(idea) })))
      setText('')
      await reload()
      notify(`${ideas.length} ${ideas.length === 1 ? 'ideia gerada' : 'ideias geradas'} e salvas no Baú de Ideias.`)
    }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
    finally { setGenerating(false) }
  }

  async function remove(id) {
    if (!window.confirm('Excluir esta ideia?')) return
    try { await apiFetch(`/api/drafts/${id}`, { method: 'DELETE' }); await reload(); notify('Ideia excluída.') }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
  }

  async function clearIdeas() {
    if (!drafts.length || !window.confirm('Esvaziar o Baú de Ideias? Todas as ideias salvas serão excluídas.')) return
    try {
      await apiFetch('/api/drafts', { method: 'DELETE' })
      await reload()
      notify('Baú de Ideias esvaziado.')
    } catch (caught) { setError(caught.message); notify(caught.message, 'error') }
  }

  function useDraft(draft) {
    const platforms = inferredPlatformsOf(draft)
    const textByPlatform = objectField(draft.text_by_platform || draft.textByPlatform)
    const titleByPlatform = objectField(draft.title_by_platform || draft.titleByPlatform)
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({
      text: textOf(draft),
      selected: platforms.length ? platforms : ['instagram'],
      publishNow: false,
      date: '',
      textByPlatform,
      titleByPlatform,
      youtubeTitle: draft.youtube_title || draft.youtubeTitle || '',
      youtubeVisibility: draft.youtube_visibility || draft.youtubeVisibility || 'public',
      youtubeMadeForKids: draft.youtube_made_for_kids == null ? '' : String(draft.youtube_made_for_kids),
      youtubeFormat: draft.youtube_format || draft.youtubeFormat || '',
      igFormat: draft.ig_format || draft.igFormat || 'post',
      facebookFormat: draft.facebook_format || draft.facebookFormat || 'post',
      tiktokPrivacyLevel: draft.tiktok_privacy_level || draft.tiktokPrivacyLevel || 'PUBLIC_TO_EVERYONE',
      savedAt: new Date().toISOString()
    }))
    notify('Ideia carregada no Meu Post. Adicione sua mídia e publique.')
    onNavigate?.('agendador')
  }

  const templatesCount = drafts.filter(draft => Boolean(draft.is_template || draft.isTemplate)).length
  const mediaCount = drafts.filter(draft => mediaItemsOf(draft).length > 0).length

  return <section className="page-view drafts-page drafts-page-v2">
    <header className="drafts-v2-heading"><div className="drafts-v2-heading-copy"><span className="drafts-v2-heading-icon" aria-hidden="true">✦</span><div><p className="eyebrow">BIBLIOTECA DE CONTEÚDO</p><h2>Baú de Ideias</h2><p>Transforme um tema em três ideias. Escolha uma e continue no criador de posts.</p></div></div><div className="drafts-v2-heading-actions"><button type="button" className="secondary-button drafts-v2-refresh" onClick={() => reload().catch(() => {})}><span aria-hidden="true">↻</span> Atualizar</button><button type="button" className="secondary-button danger-button" onClick={clearIdeas} disabled={!drafts.length}>Esvaziar Baú</button></div></header>
    <div className="drafts-v2-howto" role="note"><span className="drafts-v2-howto-icon" aria-hidden="true">i</span><div><strong>Do tema à publicação</strong><p>Gere ideias, escolha uma e clique em <b>Criar post</b> para revisar e agendar.</p></div></div>
    <div className="drafts-v2-summary" aria-label="Resumo do Baú de Ideias"><article><span className="drafts-v2-stat-icon" aria-hidden="true">▤</span><div><span>Total de ideias</span><strong>{drafts.length}</strong><small>Conteúdos salvos</small></div></article><article><span className="drafts-v2-stat-icon is-purple" aria-hidden="true">◇</span><div><span>Modelos</span><strong>{templatesCount}</strong><small>Prontos para reutilizar</small></div></article><article><span className="drafts-v2-stat-icon is-green" aria-hidden="true">▧</span><div><span>Com mídia</span><strong>{mediaCount}</strong><small>Fotos ou vídeos anexados</small></div></article></div>
    <div className="drafts-v2-workspace">
      <section className="panel drafts-v2-editor-panel">
        <div className="drafts-v2-editor-heading"><div><p className="eyebrow">CRIAR AGORA</p><h3>Gerar novas ideias</h3><p>Informe um tema e receba sugestões para revisar.</p></div><span className="drafts-v2-editor-icon" aria-hidden="true">✦</span></div>
        <form className="drafts-v2-form" onSubmit={generateIdeas}>
          <label className="drafts-v2-text-field"><span>Minhas ideias</span><textarea value={text} onChange={event => setText(event.target.value)} placeholder="Minhas ideias" aria-label="Minhas ideias para gerar conteúdo" maxLength={5000}/><span className="drafts-v2-editor-meta"><span>{text.length}/5000 caracteres</span><span>O sistema inteligente gerará 3 ideias para o Instagram</span></span></label>
          <div className="drafts-v2-form-tip"><span aria-hidden="true">✦</span><span>Descreva o tema, público, objetivo ou tom. O sistema inteligente transforma seu ponto de partida em ideias prontas.</span></div>
          <button className="action-button drafts-v2-save-button" type="submit" disabled={generating}>{generating ? 'Gerando ideias...' : 'Gerar ideias'} <span aria-hidden="true">→</span></button>
        </form>
      </section>
      <section className="panel drafts-v2-list-panel">
        <div className="drafts-v2-list-heading"><div><p className="eyebrow">SEUS CONTEÚDOS</p><h3>Ideias salvas</h3></div><span className="drafts-v2-list-count">{visibleDrafts.length} {visibleDrafts.length === 1 ? 'item' : 'itens'}</span></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="drafts-v2-toolbar"><label className="drafts-v2-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por texto, título ou rede..." aria-label="Buscar ideia" /></label><div className="drafts-v2-filter-tabs" role="tablist" aria-label="Filtrar ideias">{[['all', 'Todas'], ['drafts', 'Em andamento'], ['templates', 'Modelos']].map(([key, label]) => <button type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)} key={key}>{label}</button>)}</div></div>
        {loading ? <LoadingState>Carregando ideias...</LoadingState> : visibleDrafts.length ? <div className="drafts-v2-card-list">{visibleDrafts.map(draft => {
          const template = Boolean(draft.is_template || draft.isTemplate)
          const platforms = inferredPlatformsOf(draft)
          const fullText = textOf(draft)
          const expanded = expandedDraftId === draft.id
          const typeLabel = template ? 'Modelo' : draft.title === 'Autosave' ? 'Rascunho automático' : 'Ideia gerada'
          return <article className="drafts-v2-card" key={draft.id}><DraftMedia draft={draft}/><div className="drafts-v2-card-body"><div className="drafts-v2-card-topline"><span className={`drafts-v2-type-badge${template ? ' is-template' : ''}`}>{typeLabel}</span><time>{formatDraftDate(draft.criado_em || draft.createdAt)}</time></div><h4>{draft.title || 'Ideia sem título'}</h4><p className={expanded ? 'is-expanded' : ''}>{fullText || 'Sem texto adicionado ainda.'}</p>{fullText.length > 150 && <button type="button" className="drafts-v2-expand-button" aria-expanded={expanded} onClick={() => setExpandedDraftId(expanded ? null : draft.id)}>{expanded ? 'Mostrar menos' : 'Ver texto completo'}</button>}<div className="drafts-v2-card-footer"><div className="drafts-v2-card-platforms" aria-label={platforms.length ? platforms.map(platform => PLATFORM_LABELS[platform] || platform).join(', ') : 'Nenhuma rede selecionada'}>{platforms.length ? platforms.map(platform => <span className={`drafts-v2-platform drafts-v2-platform-${platform}`} key={platform} title={PLATFORM_LABELS[platform] || platform}><PlatformIcon platform={platform} className="h-3.5 w-3.5" /></span>) : <small>Nenhuma rede selecionada</small>}</div><span className="drafts-v2-card-actions"><button type="button" className="action-button drafts-v2-use-button" onClick={() => useDraft(draft)}>Criar post <span aria-hidden="true">→</span></button><button type="button" className="link-button danger-link" onClick={() => remove(draft.id)}>Excluir</button></span></div></div></article>
        })}</div> : <div className="drafts-v2-empty"><span aria-hidden="true">✦</span><strong>{search || filter !== 'all' ? 'Nenhuma ideia encontrada' : 'Seu baú está vazio'}</strong><p>{search || filter !== 'all' ? 'Tente mudar os filtros ou a busca.' : 'Descreva um tema ao lado para gerar suas primeiras ideias.'}</p>{(search || filter !== 'all') && <button type="button" className="link-button" onClick={() => { setSearch(''); setFilter('all') }}>Limpar filtros</button>}</div>}
      </section>
    </div>
  </section>
}
