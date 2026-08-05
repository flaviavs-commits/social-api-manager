import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { buildValidationIssues, mediaFileKey, readVideoMeta } from '../lib/postValidation.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { createPostValidationWorker } from '../lib/postValidationWorker.js'
import { findPublicationResult, latestPublicationEventId } from '../lib/publicationEvents.js'
import { useToast } from '../components/ui/toast.jsx'

const platforms = ['instagram', 'facebook', 'youtube', 'tiktok']
const AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'

function formatFileSize(bytes) {
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`
}

// Categorias da YouTube Data API v3 — espelha src/domain/posts/post.js
// (YOUTUBE_CATEGORIES), fonte da verdade no backend.
const youtubeCategories = [
  { id: '1', label: 'Filmes e animação' },
  { id: '2', label: 'Carros e veículos' },
  { id: '10', label: 'Música' },
  { id: '15', label: 'Animais' },
  { id: '17', label: 'Esportes' },
  { id: '19', label: 'Viagens e eventos' },
  { id: '20', label: 'Games' },
  { id: '22', label: 'Pessoas e blogs' },
  { id: '23', label: 'Comédia' },
  { id: '24', label: 'Entretenimento' },
  { id: '25', label: 'Notícias e política' },
  { id: '26', label: 'Como fazer e estilo' },
  { id: '27', label: 'Educação' },
  { id: '28', label: 'Ciência e tecnologia' },
]

async function uploadWithConcurrency(items, upload, limit, onProgress) {
  const results = new Array(items.length)
  let next = 0
  let completed = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await upload(items[index])
      completed += 1
      onProgress?.(completed, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function PostPreview({ text, selected, files, previews, publishNow, date }) {
  return <aside className="post-preview" aria-label="Pré-visualização da publicação">
    <div className="post-preview-heading"><div><p className="eyebrow">PREVIEW</p><h3>Como ficará</h3></div><span className="post-preview-status">{publishNow ? 'Agora' : date ? 'Agendada' : 'Rascunho'}</span></div>
    <div className="post-preview-card">
      <div className="post-preview-account"><span className="post-preview-avatar">ME</span><div><strong>Sua marca</strong><small>{selected.length ? selected.map(item => item[0].toUpperCase() + item.slice(1)).join(' · ') : 'Nenhuma rede selecionada'}</small></div></div>
      <p className={`post-preview-text${text ? '' : ' is-placeholder'}`}>{text || 'O texto da sua publicação aparecerá aqui.'}</p>
      {files.length ? <div className="post-preview-media"><div className="post-preview-media-strip">{previews.slice(0, 3).map(item => item.file.type.startsWith('image/') ? <img key={item.key} src={item.url} alt="" /> : <span className="post-preview-video" key={item.key} aria-hidden="true">▶</span>)}</div><span>{files.length} {files.length === 1 ? 'arquivo selecionado' : 'arquivos selecionados'}</span></div> : <div className="post-preview-media is-empty"><span aria-hidden="true">＋</span>Adicione uma imagem ou vídeo</div>}
      <div className="post-preview-footer"><span>♡ 0</span><span>💬 0</span><span>↗ 0</span></div>
    </div>
    <p className="post-preview-hint">O visual final pode variar de acordo com cada rede social.</p>
  </aside>
}

export function SchedulerPage() {
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [selected, setSelected] = useState(['instagram'])
  const [files, setFiles] = useState([])
  const [mediaPreviews, setMediaPreviews] = useState([])
  const [videoMetaByKey, setVideoMetaByKey] = useState({})
  const [youtubeTitle, setYoutubeTitle] = useState('')
  const [youtubeVisibility, setYoutubeVisibility] = useState('public')
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState('')
  const [igFormat, setIgFormat] = useState('post')
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('PUBLIC_TO_EVERYONE')
  const [tiktokDisableComment, setTiktokDisableComment] = useState(false)
  const [tiktokDisableDuet, setTiktokDisableDuet] = useState(false)
  const [tiktokDisableStitch, setTiktokDisableStitch] = useState(false)
  const [youtubeCategoryId, setYoutubeCategoryId] = useState('')
  const [youtubeFormat, setYoutubeFormat] = useState('')
  const [firstComment, setFirstComment] = useState('')
  const [textByPlatform, setTextByPlatform] = useState({})
  const [locationQuery, setLocationQuery] = useState('')
  const [locationResults, setLocationResults] = useState([])
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [publicationStatus, setPublicationStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [workerIssues, setWorkerIssues] = useState([])
  const [draftReady, setDraftReady] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState(null)
  const [serverDraftStatus, setServerDraftStatus] = useState('')
  const notify = useToast()
  const locationSearchTimer = useRef(null)
  const validationRequest = useRef(0)
  const publicationPollTimer = useRef(null)
  const serverDraftId = useRef(null)
  const validationWorker = useMemo(() => createPostValidationWorker(({ requestId, issues }) => {
    if (requestId === validationRequest.current) setWorkerIssues(issues)
  }), [])

  useEffect(() => () => {
    validationWorker?.terminate()
    clearTimeout(publicationPollTimer.current)
  }, [validationWorker])

  useEffect(() => {
    try {
      const savedDraft = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null')
      if (savedDraft) {
        setText(savedDraft.text || '')
        setDate(savedDraft.date || '')
        setPublishNow(Boolean(savedDraft.publishNow))
        setSelected(savedDraft.selected?.length ? savedDraft.selected : ['instagram'])
        setYoutubeTitle(savedDraft.youtubeTitle || '')
        setYoutubeVisibility(savedDraft.youtubeVisibility || 'public')
        setYoutubeMadeForKids(savedDraft.youtubeMadeForKids || '')
        setIgFormat(savedDraft.igFormat || 'post')
        setTiktokPrivacyLevel(savedDraft.tiktokPrivacyLevel || 'PUBLIC_TO_EVERYONE')
        setFirstComment(savedDraft.firstComment || '')
        setTextByPlatform(savedDraft.textByPlatform || {})
        setDraftSavedAt(savedDraft.savedAt ? new Date(savedDraft.savedAt) : null)
      }
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY)
    } finally {
      setDraftReady(true)
    }
  }, [])

  useEffect(() => {
    if (!draftReady) return undefined
    const timer = setTimeout(() => {
      const hasContent = text.trim() || firstComment.trim() || youtubeTitle.trim() || files.length
      if (!hasContent) {
        localStorage.removeItem(AUTOSAVE_KEY)
        setDraftSavedAt(null)
        return
      }
      const savedAt = new Date()
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ text, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, firstComment, textByPlatform, savedAt: savedAt.toISOString() }))
      setDraftSavedAt(savedAt)
    }, 700)
    return () => clearTimeout(timer)
  }, [draftReady, text, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, firstComment, textByPlatform, files.length])

  useEffect(() => {
    if (!draftReady) return undefined
    const hasContent = text.trim() || firstComment.trim() || youtubeTitle.trim() || files.length
    if (!hasContent) return undefined
    const timer = setTimeout(async () => {
      try {
        if (serverDraftId.current) {
          await apiFetch(`/api/drafts/${serverDraftId.current}`, { method: 'PATCH', body: JSON.stringify({ text, platforms: selected }) })
        } else {
          const result = await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Autosave', text, platforms: selected }) })
          serverDraftId.current = result.id
        }
        setServerDraftStatus('Sincronizado na conta')
      } catch {
        setServerDraftStatus('Salvo somente neste dispositivo')
      }
    }, 1800)
    return () => clearTimeout(timer)
  }, [draftReady, text, selected, firstComment, youtubeTitle, files.length])

  function monitorPublication(postId, initialCursor) {
    let cursor = initialCursor
    const poll = async () => {
      try {
        const { events = [] } = await apiFetch(`/api/logs/events/since/${cursor}`)
        if (events.length) cursor = Math.max(cursor, ...events.map(event => Number(event.id) || 0))
        const result = findPublicationResult(events, postId)
        if (result) {
          setPublicationStatus(result)
          return
        }
      } catch {
        // Uma falha pontual de rede não encerra o acompanhamento; o próximo
        // ciclo tenta novamente sem substituir a mensagem da publicação.
      }
      publicationPollTimer.current = setTimeout(poll, 4000)
    }
    poll()
  }

  function toggle(platform) { setSelected(value => value.includes(platform) ? value.filter(item => item !== platform) : [...value, platform]) }
  function addFiles(fileList) {
    const incoming = Array.from(fileList || [])
    const valid = incoming.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'))
    if (incoming.length !== valid.length) setError('Alguns arquivos foram ignorados. Selecione somente imagens ou vídeos.')
    setFiles(current => {
      const merged = [...current, ...valid]
      return merged.filter((file, index, list) => list.findIndex(item => mediaFileKey(item) === mediaFileKey(file)) === index)
    })
  }
  function selectFiles(event) { addFiles(event.target.files); event.target.value = '' }
  function dropFiles(event) { event.preventDefault(); addFiles(event.dataTransfer.files) }
  function removeFile(key) { setFiles(current => current.filter(file => mediaFileKey(file) !== key)) }

  // Lê metadados (largura/altura) dos vídeos selecionados para checar a
  // proporção exigida pelo TikTok antes do upload — ver postValidation.js.
  useEffect(() => {
    let cancelado = false
    const videos = files.filter(file => file.type.startsWith('video/'))
    Promise.all(videos.map(async file => [mediaFileKey(file), await readVideoMeta(file)])).then(pares => {
      if (cancelado) return
      setVideoMetaByKey(Object.fromEntries(pares.filter(([, meta]) => meta)))
    })
    return () => { cancelado = true }
  }, [files])

  useEffect(() => {
    const previews = files.map(file => ({ file, key: mediaFileKey(file), url: URL.createObjectURL(file) }))
    setMediaPreviews(previews)
    return () => previews.forEach(preview => URL.revokeObjectURL(preview.url))
  }, [files])

  const validationInput = {
    text, platforms: selected, files: files.map(({ name, lastModified, size, type }) => ({ name, lastModified, size, type })),
    publishNow, scheduledAt: date, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey
  }
  useEffect(() => {
    const requestId = ++validationRequest.current
    if (!validationWorker) {
      setWorkerIssues(buildValidationIssues(validationInput))
      return
    }
    validationWorker.postMessage({ ...validationInput, requestId })
  }, [validationWorker, text, selected, files, publishNow, date, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey])
  const issues = workerIssues

  // Busca de local (Facebook/Instagram) com debounce, espelhando o
  // comportamento equivalente ao fluxo anterior de busca de localização:
  // só busca com 3+ caracteres e cancela a busca anterior a cada tecla.
  useEffect(() => {
    clearTimeout(locationSearchTimer.current)
    if (locationQuery.trim().length < 3) { setLocationResults([]); return }
    locationSearchTimer.current = setTimeout(async () => {
      try {
        const { locations } = await apiFetch(`/api/posts/facebook-places?q=${encodeURIComponent(locationQuery.trim())}`)
        setLocationResults(locations || [])
      } catch { setLocationResults([]) }
    }, 400)
    return () => clearTimeout(locationSearchTimer.current)
  }, [locationQuery])

  function chooseLocation(location) {
    setSelectedLocation(location)
    setLocationQuery('')
    setLocationResults([])
  }

  async function uploadFile(file) {
    const data = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
    const response = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!response.ok) throw new Error(`Falha ao enviar ${file.name}`)
    // O endpoint de criação espera a URL pública do Blob e `mimetype`.
    // `uploadUrl` contém query params de autorização que não devem ser salvos.
    return { url: data.uploadUrl.split('?')[0], mimetype: file.type, name: file.name }
  }

  async function submit(event) {
    event.preventDefault(); setError(''); setSaved(false); setPublicationStatus(null); setProgress('')
    if (issues.length > 0) { setError(issues[0].message); return }
    setLoading(true)
    try {
      const eventCursor = publishNow ? await latestPublicationEventId(apiFetch) : 0
      setProgress(files.length ? 'Enviando mídias...' : 'Validando agendamento...')
      const media = await uploadWithConcurrency(files, uploadFile, 3, (completed, total) => setProgress(`Enviando mídias (${completed}/${total})...`))
      const scheduledAt = publishNow ? new Date().toISOString() : date
      setProgress('Processando e salvando agendamento...')
      const createdPost = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ text, scheduledAt, platforms: JSON.stringify(selected), publishNow, media: JSON.stringify(media), youtubeTitle, youtubeVisibility, youtubeMadeForKids: youtubeMadeForKids === '' ? undefined : youtubeMadeForKids === 'true', youtubeCategoryId: youtubeCategoryId || undefined, youtubeFormat: youtubeFormat || undefined, igFormat, tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch, firstComment, textByPlatform: JSON.stringify(textByPlatform), locationId: selectedLocation?.id, locationName: selectedLocation?.name }) })
      if (serverDraftId.current) { apiFetch(`/api/drafts/${serverDraftId.current}`, { method: 'DELETE' }).catch(() => {}); serverDraftId.current = null }
      setText(''); setDate(''); setFiles([]); setYoutubeTitle(''); setYoutubeMadeForKids(''); setYoutubeCategoryId(''); setYoutubeFormat(''); setTiktokDisableComment(false); setTiktokDisableDuet(false); setTiktokDisableStitch(false); setFirstComment(''); setTextByPlatform({}); setSelectedLocation(null); setLocationQuery(''); setPublishNow(false); setSaved(true); localStorage.removeItem(AUTOSAVE_KEY); setDraftSavedAt(null); setServerDraftStatus('')
      if (publishNow && createdPost?.id) {
        setPublicationStatus({ type: 'processing', message: `Post #${createdPost.id} enviado. Aguardando confirmação das redes sociais...` })
        monitorPublication(createdPost.id, eventCursor)
      }
    } catch (caught) { setError(caught.message) } finally { setLoading(false); setProgress('') }
  }

  async function saveAsTemplate() {
    if (!text.trim()) { notify('Escreva algum conteúdo antes de salvar um modelo.', 'error'); return }
    try {
      await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Modelo de publicação', text, platforms: selected, isTemplate: true, firstComment, textByPlatform }) })
      notify('Modelo salvo nos seus rascunhos.')
    } catch (caught) {
      notify(caught.message, 'error')
    }
  }

  return <section className="page-view scheduler-page"><section className="panel scheduler-panel"><header className="scheduler-heading"><div><p className="eyebrow">PUBLICAÇÃO</p><h2>{publishNow ? 'Publicar agora' : 'Agendar publicação'}</h2><p>Prepare uma publicação e distribua para as redes selecionadas.</p></div>{(draftSavedAt || serverDraftStatus) && <span className="autosave-status" role="status">{serverDraftStatus || `Salvo localmente às ${draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span>}</header><div className="scheduler-workspace"><form className="draft-form sched-form" onSubmit={submit}>

    <SchedSection number={1} title="Plataformas">
      <div className="platform-options">{platforms.map(platform => <label key={platform}><input type="checkbox" checked={selected.includes(platform)} onChange={() => toggle(platform)}/><PlatformIcon platform={platform} className="h-4 w-4"/><span>{platform[0].toUpperCase() + platform.slice(1)}</span></label>)}</div>
    </SchedSection>

    <SchedSection number={2} title="Conteúdo">
      <label>Texto do post<textarea value={text} onChange={event => setText(event.target.value)} maxLength={5000} placeholder="Escreva o texto da publicação..." aria-label="Texto da publicação" aria-describedby="post-text-help"/><span id="post-text-help" className="field-help"><span>Adapte a mensagem para cada rede se necessário.</span><span>{text.length}/5000</span></span></label>
      <div className="upload-field" onDragOver={event => event.preventDefault()} onDrop={dropFiles}>
        <label> Mídias<input type="file" multiple accept="image/*,video/*" onChange={selectFiles} aria-label="Selecionar imagens ou vídeos"/><span className="field-help">Imagens e vídeos serão validados antes da publicação.</span></label>
        <p className="upload-drop-hint">Arraste os arquivos até aqui ou use o seletor acima.</p>
      </div>
      {files.length > 0 && <div className="media-preview-grid" aria-label="Arquivos selecionados">{mediaPreviews.map(item => <article className="media-preview-card" key={item.key}>
        {item.file.type.startsWith('image/') ? <img src={item.url} alt={`Prévia de ${item.file.name}`} /> : <div className="media-video-thumb" aria-label={`Vídeo ${item.file.name}`}><span aria-hidden="true">▶</span></div>}
        <div className="media-preview-info"><strong title={item.file.name}>{item.file.name}</strong><small>{formatFileSize(item.file.size)}</small></div>
        <button type="button" className="media-remove-button" onClick={() => removeFile(item.key)} aria-label={`Remover ${item.file.name}`}>×</button>
      </article>)}</div>}
      {selected.length > 1 && <div className="advanced-options" style={{ marginTop: 12 }}>{selected.map(platform => <label key={platform}>Texto para {platform} (opcional)<textarea value={textByPlatform[platform] || ''} onChange={event => setTextByPlatform(value => ({ ...value, [platform]: event.target.value }))} maxLength={5000}/></label>)}</div>}
    </SchedSection>

    <SchedSection number={3} title="Configurações por rede">
      <div className="advanced-options">
        {selected.includes('youtube') && <>
          <label>Título do YouTube<input value={youtubeTitle} onChange={event => setYoutubeTitle(event.target.value)} maxLength={100}/></label>
          <label>Visibilidade<select value={youtubeVisibility} onChange={event => setYoutubeVisibility(event.target.value)}><option value="public">Público</option><option value="unlisted">Não listado</option><option value="private">Privado</option></select></label>
          <label>Feito para crianças (YouTube)<select value={youtubeMadeForKids} onChange={event => setYoutubeMadeForKids(event.target.value)}><option value="">Selecione...</option><option value="false">Não</option><option value="true">Sim</option></select></label>
          <label>Categoria do YouTube<select value={youtubeCategoryId} onChange={event => setYoutubeCategoryId(event.target.value)}><option value="">Automática</option>{youtubeCategories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label>Formato do YouTube<select value={youtubeFormat} onChange={event => setYoutubeFormat(event.target.value)}><option value="">Automático</option><option value="video">Vídeo</option><option value="short">Short</option></select></label>
        </>}
        {selected.includes('instagram') && <label>Formato Instagram<select value={igFormat} onChange={event => setIgFormat(event.target.value)}><option value="post">Feed</option><option value="reel">Reel</option><option value="story">Story</option></select></label>}
        {selected.includes('tiktok') && <>
          <label>Privacidade TikTok<select value={tiktokPrivacyLevel} onChange={event => setTiktokPrivacyLevel(event.target.value)}><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="SELF_ONLY">Somente eu</option></select></label>
          <fieldset className="checkbox-group"><legend>Interações do TikTok</legend><div className="checkbox-row"><label><input type="checkbox" checked={tiktokDisableComment} onChange={event => setTiktokDisableComment(event.target.checked)}/> Bloquear comentários</label><label><input type="checkbox" checked={tiktokDisableDuet} onChange={event => setTiktokDisableDuet(event.target.checked)}/> Bloquear duet</label><label><input type="checkbox" checked={tiktokDisableStitch} onChange={event => setTiktokDisableStitch(event.target.checked)}/> Bloquear stitch</label></div></fieldset>
        </>}
        {(selected.includes('facebook') || selected.includes('instagram')) && <label className="location-field">Local (Facebook/Instagram)<input value={locationQuery} onChange={event => setLocationQuery(event.target.value)} placeholder="Buscar local (ex: Av. Paulista, São Paulo)" autoComplete="off"/>{locationResults.length > 0 && <ul className="location-results">{locationResults.map(location => <li key={location.id}><button type="button" onClick={() => chooseLocation(location)}>{location.name}</button></li>)}</ul>}{selectedLocation && <p className="location-selected">{selectedLocation.name} <button type="button" onClick={() => setSelectedLocation(null)}>✕</button></p>}</label>}
        <label>Primeiro comentário<textarea value={firstComment} onChange={event => setFirstComment(event.target.value)} maxLength={2000}/></label>
        {selected.length === 0 && <p className="empty-state">Escolha ao menos uma rede acima para ver as opções específicas dela.</p>}
      </div>
    </SchedSection>

    <SchedSection number={4} title="Agendamento">
      <label className="mode-toggle"><input type="checkbox" checked={publishNow} onChange={event => setPublishNow(event.target.checked)}/> Publicar imediatamente</label>
      {!publishNow && <label>Data e hora<input required type="datetime-local" value={date} onChange={event => setDate(event.target.value)}/></label>}
    </SchedSection>

    {issues.length > 0 && <div className="validation-panel" aria-live="polite"><p className="validation-panel-heading">⚠ {issues.length} {issues.length === 1 ? 'pendência' : 'pendências'} antes de {publishNow ? 'publicar' : 'agendar'}</p><ul className="validation-panel-list">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div>}
    <div className="scheduler-submit-actions"><button className="action-button" disabled={loading || issues.length > 0}>{loading ? progress || 'Processando...' : publishNow ? 'Publicar agora' : 'Agendar'}</button><button type="button" className="secondary-button" onClick={saveAsTemplate} disabled={loading || !text.trim()}>Salvar como modelo</button></div>
  </form><PostPreview text={text} selected={selected} files={files} previews={mediaPreviews} publishNow={publishNow} date={date}/></div>{saved && !publicationStatus && <p className="success-message">Publicação agendada.</p>}{publicationStatus && <p className={publicationStatus.type === 'error' ? 'error-message' : 'success-message'} role={publicationStatus.type === 'error' ? 'alert' : 'status'}>{publicationStatus.message}</p>}{error && <p className="error-message" role="alert">{error}</p>}</section></section>
}
