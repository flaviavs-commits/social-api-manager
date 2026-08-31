import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'

const platforms = [
  ['instagram', 'Instagram', '◎'],
  ['facebook', 'Facebook', 'f'],
  ['youtube', 'YouTube', '▶'],
  ['tiktok', 'TikTok', '♪'],
]

const suggestionExamples = ['Educação financeira', 'Bastidores do negócio', 'Dicas para iniciantes']

export const MEDIA_LIBRARY_SELECTION_KEY = 'meu-ecoo:media-library-selection'

function formatSize(value) {
  const bytes = Number(value || 0)
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function platformLabel(platform) {
  return platforms.find(([id]) => id === platform)?.[1] || platform
}

function inferNicheFromInsights(insights) {
  return insights?.nicheComparisons?.[0]?.niche
    || insights?.performanceAnalysis?.comparisons?.find(item => item.topPost?.niche && item.topPost.niche !== 'não identificado')?.topPost?.niche
    || insights?.profileComparison?.find(item => item.niche && item.niche !== 'não identificado')?.niche
    || ''
}

function suggestionText(post) {
  return post?.texto || post?.text || post?.caption || ''
}

export function MediaLibraryPage({ onNavigate }) {
  const [assets, setAssets] = useState([])
  const [folders, setFolders] = useState([])
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('')
  const [uploadFolder, setUploadFolder] = useState('Geral')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [suggestionNiche, setSuggestionNiche] = useState('')
  const [suggestionDays, setSuggestionDays] = useState(30)
  const [suggestionPlatforms, setSuggestionPlatforms] = useState(['instagram'])
  const [suggestions, setSuggestions] = useState([])
  const [suggestionInsights, setSuggestionInsights] = useState(null)
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [savedSuggestions, setSavedSuggestions] = useState([])
  const notify = useToast()

  const load = useCallback(() => apiFetch(`/api/media-assets?search=${encodeURIComponent(search)}&folder=${encodeURIComponent(folder)}`).then(data => setAssets(data.assets || [])), [folder, search])

  useEffect(() => {
    setLoading(true)
    load().catch(error => notify(error.message, 'error')).finally(() => setLoading(false))
  }, [load, notify])

  useEffect(() => {
    apiFetch('/api/media-folders').then(data => setFolders(data.folders || [])).catch(error => notify(error.message, 'error'))
  }, [notify])

  function selectFolder(nextFolder) {
    setFolder(nextFolder)
    setUploadFolder(nextFolder || 'Geral')
  }

  async function createFolder(event) {
    event.preventDefault()
    if (!newFolderName.trim()) return
    setCreatingFolder(true)
    try {
      const data = await apiFetch('/api/media-folders', { method: 'POST', body: JSON.stringify({ name: newFolderName }) })
      const created = data.folder
      setFolders(current => [...current, created].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')))
      selectFolder(created.name)
      setNewFolderName('')
      setFolderDialogOpen(false)
      notify(`Pasta “${created.name}” criada.`)
    } catch (error) { notify(error.message, 'error') } finally { setCreatingFolder(false) }
  }

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
        const mediaUrl = signed.mediaUrl || uploaded?.url
        if (!mediaUrl) throw new Error(`O upload de ${file.name} não retornou uma URL.`)
        await apiFetch('/api/media-assets', { method: 'POST', body: JSON.stringify({ name: file.name, url: mediaUrl, mimeType: file.type, sizeBytes: file.size, folder: uploadFolder || 'Geral' }) })
      }
      const foldersData = await apiFetch('/api/media-folders')
      setFolders(foldersData.folders || [])
      await load()
      notify(`${files.length} mídia(s) adicionada(s) à biblioteca.`)
    } catch (error) { notify(error.message, 'error') } finally { setUploading(false) }
  }

  async function remove(asset) {
    if (!window.confirm(`Remover ${asset.name} da biblioteca?`)) return
    try { await apiFetch(`/api/media-assets/${asset.id}`, { method: 'DELETE' }); setAssets(current => current.filter(item => item.id !== asset.id)); notify('Mídia removida.') }
    catch (error) { notify(error.message, 'error') }
  }

  function useAssetInPost(asset) {
    try {
      sessionStorage.setItem(MEDIA_LIBRARY_SELECTION_KEY, JSON.stringify({ id: asset.id, name: asset.name, url: asset.url, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes }))
      onNavigate?.('agendador')
    } catch (error) { notify(error.message || 'Não foi possível preparar a mídia.', 'error') }
  }

  function toggleSuggestionPlatform(platform) {
    setSuggestionPlatforms(current => current.includes(platform) ? current.filter(item => item !== platform) : [...current, platform])
  }

  function buildSuggestionInstruction(insights, niche) {
    const comparisons = insights?.performanceAnalysis?.comparisons || []
    const signals = comparisons.flatMap(item => (item.signals || []).slice(0, 2).map(signal => `${item.platformLabel}: ${signal}`)).slice(0, 6)
    const recommendations = (insights?.recommendations || []).slice(0, 3)
    const dataNote = insights?.dataQuality?.hasEnoughData
      ? 'Use estes sinais como referência prática, sem repetir as mesmas publicações.'
      : 'Os dados ainda são limitados; trate os sinais como hipóteses de teste, não como certezas.'

    return [
      `Crie 3 sugestões de posts originais para o nicho ${niche || 'identificado a partir do histórico da conta'}.`,
      `Adapte cada ideia para ${suggestionPlatforms.map(platformLabel).join(', ')}.`,
      'Priorize ganchos claros, utilidade para o público, potencial de comentários, salvamentos ou compartilhamentos e uma chamada para ação natural.',
      'Varie os formatos: uma ideia educativa, uma ideia de conversa/comunidade e uma ideia de prova, bastidor ou aplicação prática.',
      'Não invente tendências, números, notícias, resultados ou referências externas. Não copie nenhum post anterior.',
      dataNote,
      signals.length ? `Sinais observados no histórico: ${signals.join(' | ')}` : 'Não há sinais de conteúdo suficientes no histórico para sustentar uma conclusão forte.',
      recommendations.length ? `Recomendações do Analytics: ${recommendations.join(' | ')}` : 'Não há recomendações de Analytics disponíveis.',
    ].join('\n')
  }

  async function generateContentSuggestions() {
    if (!suggestionPlatforms.length) {
      notify('Selecione pelo menos uma rede social.', 'error')
      return
    }
    setSuggestionLoading(true)
    try {
      const analyticsData = await apiFetch(`/api/ai/analytics-insights?days=${suggestionDays}`)
      const insights = analyticsData.insights || null
      setSuggestionInsights(insights)
      const inferredNiche = suggestionNiche.trim() || inferNicheFromInsights(insights) || 'o seu nicho'
      if (!suggestionNiche.trim() && inferredNiche !== 'o seu nicho') setSuggestionNiche(inferredNiche)
      const generated = await apiFetch('/api/ai/generate', {
        method: 'POST',
        timeoutMs: 60_000,
        body: JSON.stringify({ instrucao: buildSuggestionInstruction(insights, inferredNiche), plataformas: suggestionPlatforms, quantidade: 3, tom: 'profissional', modelo: 'openrouter' }),
      })
      const nextSuggestions = (generated.posts || []).map((post, index) => ({ ...post, suggestionId: `${Date.now()}-${index}`, text: suggestionText(post) }))
      setSuggestions(nextSuggestions)
      if (!nextSuggestions.length) notify('A IA não retornou sugestões desta vez.', 'error')
    } catch (error) {
      notify(error.message || 'Não foi possível gerar sugestões agora.', 'error')
    } finally { setSuggestionLoading(false) }
  }

  async function saveSuggestionToIdeaVault(suggestion) {
    const text = suggestionText(suggestion)
    if (!text.trim()) return
    try {
      await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: suggestion.titulo || `Ideia IA · ${suggestionNiche || 'novo conteúdo'}`, text, platforms: suggestion.plataformas?.length ? suggestion.plataformas : suggestionPlatforms }) })
      setSavedSuggestions(current => [...current, suggestion.suggestionId])
      notify('Ideia salva no Baú de Ideias.')
    } catch (error) { notify(error.message, 'error') }
  }

  const quality = suggestionInsights?.dataQuality
  const inferredNiche = suggestionNiche || inferNicheFromInsights(suggestionInsights)

  const folderOptions = [{ name: 'Geral', assetCount: folders.find(item => item.name.toLowerCase() === 'geral')?.assetCount || 0 }, ...folders.filter(item => item.name.toLowerCase() !== 'geral')]

  return <section className="page-view media-library-page">
    <header className="media-library-heading"><div className="media-library-heading-copy"><span className="media-library-heading-icon" aria-hidden="true">▧</span><div><p className="eyebrow">BIBLIOTECA DE CONTEÚDO</p><h2>Biblioteca de mídia</h2><p>Centralize fotos e vídeos e descubra novas ideias a partir do que já funciona nas suas redes.</p></div></div><div className="media-library-heading-actions"><button type="button" className="secondary-button media-library-folder-button" onClick={() => setFolderDialogOpen(current => !current)}>＋ Nova pasta</button><label className="action-button media-library-upload-button">{uploading ? 'Enviando…' : 'Adicionar mídia'}<input type="file" hidden multiple accept="image/*,video/*" onChange={upload} disabled={uploading} /></label></div></header>
    {folderDialogOpen && <form className="media-library-folder-form" onSubmit={createFolder}><label><span>Nome da nova pasta</span><input autoFocus value={newFolderName} onChange={event => setNewFolderName(event.target.value)} placeholder="Ex.: Campanhas de verão" maxLength={80} /></label><button type="button" className="secondary-button" onClick={() => { setFolderDialogOpen(false); setNewFolderName('') }}>Cancelar</button><button type="submit" className="action-button" disabled={creatingFolder || !newFolderName.trim()}>{creatingFolder ? 'Criando…' : 'Criar pasta'}</button></form>}

    <section className="media-ai-opportunities" aria-labelledby="media-ai-opportunities-title">
      <div className="media-ai-opportunities-heading">
        <div className="media-ai-opportunities-title">
          <span className="media-ai-opportunities-icon" aria-hidden="true">✦</span>
          <div>
            <p className="eyebrow">ASSISTENTE DE CONTEÚDO</p>
            <h3 id="media-ai-opportunities-title">Encontre sua próxima oportunidade</h3>
            <p>A IA cruza seu nicho com os sinais disponíveis no Analytics e sugere ideias para testar.</p>
          </div>
        </div>
        <span className="media-ai-data-badge">{suggestionInsights ? 'Baseado no seu histórico' : 'Analisa seu histórico'}</span>
      </div>
      <div className="media-ai-opportunities-controls">
        <label>
          <span>Nicho ou tema principal <em>opcional</em></span>
          <input value={suggestionNiche} onChange={event => setSuggestionNiche(event.target.value)} placeholder="Ex.: educação financeira" />
        </label>
        <label>
          <span>Período do histórico</span>
          <select value={suggestionDays} onChange={event => setSuggestionDays(Number(event.target.value))}>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        <div className="media-ai-platform-picker">
          <span>Redes para adaptar <small>{suggestionPlatforms.length} selecionada{suggestionPlatforms.length === 1 ? '' : 's'}</small></span>
          <div>
            {platforms.map(([id, label, icon]) => <button type="button" className={suggestionPlatforms.includes(id) ? 'is-selected' : ''} onClick={() => toggleSuggestionPlatform(id)} key={id} aria-pressed={suggestionPlatforms.includes(id)}><b aria-hidden="true">{icon}</b>{label}</button>)}
          </div>
        </div>
        <button type="button" className="action-button media-ai-generate-button" onClick={generateContentSuggestions} disabled={suggestionLoading}>
          <span aria-hidden="true">✦</span>{suggestionLoading ? 'Analisando e criando…' : suggestions.length ? 'Gerar novas ideias' : 'Gerar sugestões'}
        </button>
      </div>
      {suggestionInsights && <div className="media-ai-insight-summary"><div className="media-ai-insight-metrics"><span><strong>{quality?.publications || 0}</strong> publicações analisadas</span><span><strong>{quality?.profiles || 0}</strong> perfis com dados</span><span><strong>{inferredNiche || 'Nicho aberto'}</strong> nicho de referência</span></div><p>{suggestionInsights.summary}</p>{suggestionInsights.recommendations?.length ? <div className="media-ai-insight-tips">{suggestionInsights.recommendations.slice(0, 2).map((tip, index) => <span key={index}><b>{index + 1}</b>{tip}</span>)}</div> : null}</div>}
      {suggestionLoading && <div className="media-ai-opportunities-loading" role="status" aria-live="polite"><span className="media-ai-opportunities-loading-icon" aria-hidden="true">✦</span><div><strong>Lendo seus sinais e preparando ideias</strong><p>A IA está combinando seu histórico com as redes escolhidas.</p></div><span className="media-ai-loading-dots" aria-hidden="true">•••</span></div>}
      {suggestions.length ? <div className="media-ai-suggestions" aria-live="polite">{suggestions.map((suggestion, index) => <article className="media-ai-suggestion-card" key={suggestion.suggestionId}><div className="media-ai-suggestion-card-heading"><span className="media-ai-suggestion-number">{String(index + 1).padStart(2, '0')}</span><div><span className="media-ai-card-kicker">IDEIA PARA TESTAR</span><h4>{suggestion.titulo || `Sugestão ${index + 1}`}</h4></div></div><p className="media-ai-suggestion-text">{suggestion.text}</p><div className="media-ai-suggestion-reason"><b>Por que vale testar</b><span>{suggestionInsights?.recommendations?.[index % (suggestionInsights.recommendations?.length || 1)] || 'A ideia combina o nicho informado com um formato de conteúdo fácil de testar e comparar.'}</span></div><footer><span>{(suggestion.plataformas?.length ? suggestion.plataformas : suggestionPlatforms).map(platformLabel).join(' · ')}</span><button type="button" className="secondary-button" onClick={() => saveSuggestionToIdeaVault(suggestion)} disabled={savedSuggestions.includes(suggestion.suggestionId)}>{savedSuggestions.includes(suggestion.suggestionId) ? 'Salvo no Baú de Ideias' : 'Salvar no Baú de Ideias'}</button></footer></article>)}</div> : !suggestionLoading && <div className="media-ai-opportunities-empty"><span className="media-ai-opportunities-empty-icon" aria-hidden="true">✦</span><div className="media-ai-opportunities-empty-copy"><strong>Comece com um tema ou deixe a IA descobrir</strong><p>Informe um assunto para direcionar as ideias. Se deixar em branco, o sistema tenta encontrar um nicho no seu histórico.</p></div><div className="media-ai-opportunities-examples" aria-label="Temas sugeridos">{suggestionExamples.map(example => <button type="button" key={example} onClick={() => setSuggestionNiche(example)}>{example}</button>)}</div></div>}
    </section>

    <section className="panel media-library-assets-panel"><div className="media-library-assets-toolbar"><div><p className="eyebrow">SEU ACERVO</p><h3>Mídias salvas</h3></div><div className="media-library-filters"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome ou tag…" aria-label="Buscar mídia" /><select value={folder} onChange={event => selectFolder(event.target.value)} aria-label="Filtrar pasta"><option value="">Todas as pastas</option>{folderOptions.map(option => <option value={option.name} key={option.name}>{option.name}</option>)}</select></div></div><div className="media-library-folder-tabs" role="tablist" aria-label="Pastas da biblioteca"><button type="button" className={!folder ? 'is-active' : ''} onClick={() => selectFolder('')}>Todas <small>{folders.reduce((total, item) => total + Number(item.assetCount || 0), 0)}</small></button>{folderOptions.map(option => <button type="button" className={folder === option.name ? 'is-active' : ''} onClick={() => selectFolder(option.name)} key={option.name}>{option.name} <small>{option.assetCount || 0}</small></button>)}</div><label className="media-library-upload-folder"><span>Destino dos próximos uploads</span><select value={uploadFolder} onChange={event => setUploadFolder(event.target.value)}>{folderOptions.map(option => <option value={option.name} key={option.name}>{option.name}</option>)}</select></label>{loading ? <p className="empty-state">Carregando biblioteca…</p> : assets.length ? <div className="media-library-grid">{assets.map(asset => <article className="media-library-asset-card" key={asset.id}><div className="media-library-asset-preview">{asset.mimeType?.startsWith('video/') ? <video src={asset.url} muted controls preload="metadata" /> : <img src={asset.url} alt={asset.name} />}</div><div className="media-library-asset-body"><strong title={asset.name}>{asset.name}</strong><small>{asset.folder}{asset.sizeBytes ? ` · ${formatSize(asset.sizeBytes)}` : ''}</small>{asset.tags?.length ? <div className="media-library-tags">{asset.tags.map(tag => <span key={tag}>#{tag}</span>)}</div> : null}<button type="button" className="media-library-use-button" onClick={() => useAssetInPost(asset)}>Usar no Meu Post</button><button type="button" className="media-library-remove-button" onClick={() => remove(asset)}>Remover da biblioteca</button></div></article>)}</div> : <div className="empty-state media-library-empty"><strong>Nenhuma mídia encontrada</strong><p>Adicione fotos ou vídeos para montar seu acervo reutilizável.</p></div>}</section>
  </section>
}
