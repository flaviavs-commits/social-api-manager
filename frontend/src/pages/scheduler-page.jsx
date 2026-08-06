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

const aiPlatformLabels = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
const MEDIA_AI_MODEL = 'openrouter'
function canvasToAnalysisData(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
  return { mediaBase64: dataUrl.split(',')[1], mimeType: 'image/jpeg' }
}

function compressImageForAnalysis(file) {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const maxDimension = 1024
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve({ ...canvasToAnalysisData(canvas), mediaKind: 'image' })
      } catch (error) { reject(error) } finally { URL.revokeObjectURL(sourceUrl) }
    }
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); reject(new Error(`Não foi possível ler ${file.name}.`)) }
    image.src = sourceUrl
  })
}

function captureVideoFrameForAnalysis(file) {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    let finished = false
    const cleanup = () => { URL.revokeObjectURL(sourceUrl); video.removeAttribute('src'); video.load() }
    const fail = error => { if (!finished) { finished = true; cleanup(); reject(error) } }
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      try { video.currentTime = Number.isFinite(video.duration) ? Math.min(Math.max(video.duration / 2, 0), 3) : 0 } catch { fail(new Error(`Não foi possível preparar ${file.name}.`)) }
    }
    video.onseeked = () => {
      if (finished) return
      try {
        const maxDimension = 1024
        const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        finished = true
        resolve({ ...canvasToAnalysisData(canvas), mediaKind: 'video' })
        cleanup()
      } catch { fail(new Error(`Não foi possível capturar um frame de ${file.name}.`)) }
    }
    video.onerror = () => fail(new Error(`Não foi possível ler ${file.name}.`))
    video.src = sourceUrl
    video.load()
  })
}

async function buildMediaAnalysisPayload(file) {
  return file.type.startsWith('video/') ? captureVideoFrameForAnalysis(file) : compressImageForAnalysis(file)
}

function cleanAiTag(tag) {
  return String(tag || '').trim().replace(/^#+/, '').replace(/\s+/g, '')
}

function uniqueAiTags(suggestion) {
  return Array.from(new Set([
    ...(suggestion.hashtagsEmAlta || []),
    ...(suggestion.hashtagsNicho || []),
    ...(suggestion.hashtags || []),
  ].map(cleanAiTag).filter(Boolean)))
}

function MediaAiSuggestions({ files, selected, contexto, previews, onApply }) {
  const [busy, setBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  async function analyzeMedia() {
    if (!files.length || !selected.length) return
    setBusy(true)
    setAnalysisError('')
    setSuccessMessage('')
    const targets = files.slice(0, 6)
    const settled = await Promise.allSettled(targets.map(async file => {
      const media = await buildMediaAnalysisPayload(file)
      const response = await apiFetch('/api/ai/analyze-media', {
        method: 'POST',
        body: JSON.stringify({ ...media, plataformas: selected, contexto, modelo: MEDIA_AI_MODEL }),
      })
      return { key: mediaFileKey(file), fileName: file.name, mediaType: media.mediaKind, previewUrl: previews.find(item => item.key === mediaFileKey(file))?.url, ...response }
    }))
    const successful = settled.filter(item => item.status === 'fulfilled').map(item => item.value)
    const failures = settled.filter(item => item.status === 'rejected')
    if (failures.length) {
      const firstMessage = failures[0].reason?.message || ''
      setAnalysisError(firstMessage.includes('limite') || firstMessage.includes('429')
        ? 'O OpenRouter atingiu o limite de requisições. Tente novamente em instantes.'
        : `${failures.length} mídia(s) não puderam ser analisadas. Confira o arquivo e tente novamente.`)
    }
    if (successful.length) {
      const firstResult = successful[0]
      const suggestions = selected.map(platform => firstResult.sugestoes?.find(item => item.plataforma === platform)).filter(Boolean)
      if (suggestions.length) suggestions.forEach(suggestion => onApply(suggestion, { silent: true }))
      setSuccessMessage(`Descrição inserida diretamente no campo do post para ${suggestions.length || 1} rede(s).`)
    }
    setBusy(false)
  }

  return <div className="media-ai-inline" aria-label="Gerar descrição do post com inteligência artificial">
    <button type="button" className="media-ai-button" onClick={analyzeMedia} disabled={busy || !files.length || !selected.length}>{busy ? 'Analisando mídia...' : '✦ Gerar descrição do post'}</button>
    {!files.length && <small className="media-ai-help">Adicione uma imagem ou vídeo para gerar a descrição.</small>}
    {!selected.length && <small className="media-ai-help">Selecione ao menos uma rede social.</small>}
    {files.length > 6 && <small className="media-ai-help">Serão analisadas as primeiras 6 mídias.</small>}
    {analysisError && <small className="media-ai-error" role="alert">{analysisError}</small>}
    {successMessage && <small className="media-ai-success" role="status">✓ {successMessage}</small>}
  </div>
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

const previewLabels = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }

function PreviewMedia({ platform, previews, igFormat, accountHandle }) {
  if (!previews.length) return <div className={`social-preview-media social-preview-media-${platform} is-empty`}><span aria-hidden="true">＋</span><small>Adicione uma imagem ou vídeo</small></div>
  const item = previews[0]
  const isVideo = item.file.type.startsWith('video/')
  const media = isVideo
    ? <div className="social-preview-video"><video src={item.url} controls muted playsInline preload="metadata" aria-label="Prévia do vídeo selecionado"/><span className="social-preview-video-badge">Vídeo selecionado</span></div>
    : <img src={item.url} alt="Prévia da publicação"/>
  return <div className={`social-preview-media social-preview-media-${platform}${platform === 'instagram' && ['reel', 'story'].includes(igFormat) ? ' is-vertical' : ''}`}>{media}{platform === 'instagram' && previews.length > 1 && <div className="social-preview-carousel-dots" aria-label={`${previews.length} mídias em carrossel`}>{previews.slice(0, 5).map((preview, index) => <span className={index === 0 ? 'is-active' : ''} key={preview.key}/>)}</div>}{platform === 'tiktok' && <div className="social-preview-tiktok-overlay"><strong>{accountHandle}</strong><span>♡ 0</span><span>💬 0</span><span>↗</span></div>}</div>
}

function PostPreview({ text, selected, files, previews, publishNow, date, youtubeTitle, igFormat, accounts }) {
  const availablePlatforms = selected.length ? selected : platforms
  const [activePlatform, setActivePlatform] = useState(availablePlatforms[0])
  useEffect(() => {
    if (!availablePlatforms.includes(activePlatform)) setActivePlatform(availablePlatforms[0])
  }, [activePlatform, availablePlatforms.join(',')])
  const activeText = text
  const isYoutube = activePlatform === 'youtube'
  const isTiktok = activePlatform === 'tiktok'
  const isFacebook = activePlatform === 'facebook'
  const connectedAccount = accounts.find(account => account.platform === activePlatform)
  const rawHandle = connectedAccount?.handle || connectedAccount?.name || ''
  const accountLabel = rawHandle || 'Sua marca'
  const accountHandle = rawHandle ? (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`) : '@sua_marca'
  const formatLabel = activePlatform === 'instagram' ? (['reel', 'story'].includes(igFormat) ? 'Vertical · 9:16' : 'Feed · 1:1 a 3:4') : activePlatform === 'youtube' ? 'Thumbnail · 16:9' : activePlatform === 'tiktok' ? 'Vídeo vertical · 9:16' : 'Feed · imagem ou vídeo'
  return <aside className="post-preview" aria-label="Pré-visualização da publicação">
    <div className="post-preview-heading"><div><p className="eyebrow">PREVIEW REALISTA</p><h3>Veja em cada rede</h3></div><span className="post-preview-status">{publishNow ? 'Agora' : date ? 'Agendada' : 'Rascunho'}</span></div>
    <div className="preview-network-tabs" role="tablist" aria-label="Prévia por rede social">{availablePlatforms.map(platform => <button type="button" role="tab" aria-selected={activePlatform === platform} className={`preview-network-tab preview-network-tab-${platform}${activePlatform === platform ? ' is-active' : ''}`} key={platform} onClick={() => setActivePlatform(platform)}><span className="preview-network-tab-icon"><PlatformIcon platform={platform} className="h-4 w-4"/></span>{previewLabels[platform]}</button>)}</div>
    <div className="social-preview-format"><span>Formato simulado</span><strong>{formatLabel}</strong></div><div className={`social-preview-card social-preview-card-${activePlatform}`}>
      <div className="social-preview-account"><span className={`social-preview-avatar social-preview-avatar-${activePlatform}`}>{connectedAccount?.avatarUrl ? <img src={connectedAccount.avatarUrl} alt=""/> : <PlatformIcon platform={activePlatform} className="h-4 w-4"/>}</span><div><strong>{accountLabel}</strong><small>{previewLabels[activePlatform]} · agora</small></div><span className="social-preview-more" aria-hidden="true">•••</span></div>
      {isYoutube ? <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} accountHandle={accountHandle}/><div className="social-preview-youtube-copy"><strong>{youtubeTitle || activeText || 'Título do seu vídeo aparecerá aqui'}</strong><small>{accountLabel} · 0 visualizações · agora</small></div></> : isTiktok ? <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} accountHandle={accountHandle}/><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'A legenda do seu vídeo aparecerá aqui.'}</p></> : isFacebook ? <><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'O texto da sua publicação aparecerá aqui.'}</p><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} accountHandle={accountHandle}/><div className="social-preview-actions"><span>♡</span><span>◯</span><span>↗</span><small>{files.length ? `${files.length} mídia${files.length > 1 ? 's' : ''}` : 'Sem mídia'}</small></div></> : <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} accountHandle={accountHandle}/><div className="social-preview-actions"><span>♡</span><span>◯</span><span>↗</span><small>{files.length ? `${files.length} mídia${files.length > 1 ? 's' : ''}` : 'Sem mídia'}</small></div><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'O texto da sua publicação aparecerá aqui.'}</p></>}
    </div>
    <p className="post-preview-hint">A prévia simula a estrutura visual da rede. O resultado final pode variar conforme o formato e a conta.</p>
  </aside>
}

export function SchedulerPage() {
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [selected, setSelected] = useState(['instagram'])
  const [connectedAccounts, setConnectedAccounts] = useState([])
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

  useEffect(() => {
    apiFetch('/api/accounts').then(data => setConnectedAccounts(data.data || [])).catch(() => setConnectedAccounts([]))
  }, [])

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
      const hasContent = text.trim() || youtubeTitle.trim() || files.length
      if (!hasContent) {
        localStorage.removeItem(AUTOSAVE_KEY)
        setDraftSavedAt(null)
        return
      }
      const savedAt = new Date()
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ text, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, savedAt: savedAt.toISOString() }))
      setDraftSavedAt(savedAt)
    }, 700)
    return () => clearTimeout(timer)
  }, [draftReady, text, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, files.length])

  useEffect(() => {
    if (!draftReady) return undefined
    const hasContent = text.trim() || youtubeTitle.trim() || files.length
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
  }, [draftReady, text, selected, youtubeTitle, files.length])

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
  function applyMediaSuggestion(suggestion, options = {}) {
    const tags = uniqueAiTags(suggestion)
    const composedText = [suggestion.texto?.trim(), tags.length ? tags.map(tag => `#${tag}`).join(' ') : ''].filter(Boolean).join('\n\n')
    setTextByPlatform(current => ({ ...current, [suggestion.plataforma]: composedText }))
    if (suggestion.plataforma === selected[0]) setText(composedText)
    if (suggestion.plataforma === 'youtube' && suggestion.titulo) setYoutubeTitle(suggestion.titulo)
    if (!options.silent) notify(`Sugestão aplicada para ${aiPlatformLabels[suggestion.plataforma] || suggestion.plataforma}.`)
  }

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
    const uploaded = await response.json().catch(() => null)
    // A URL usada no PUT é temporária; o corpo da resposta contém a URL
    // pública final que deve ser salva no post.
    if (!uploaded?.url) throw new Error(`O upload de ${file.name} não retornou uma URL pública válida.`)
    return { url: uploaded.url, mimetype: file.type, name: file.name }
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
      const createdPost = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ text, scheduledAt, platforms: JSON.stringify(selected), publishNow, media: JSON.stringify(media), youtubeTitle, youtubeVisibility, youtubeMadeForKids: youtubeMadeForKids === '' ? undefined : youtubeMadeForKids === 'true', youtubeCategoryId: youtubeCategoryId || undefined, youtubeFormat: youtubeFormat || undefined, igFormat, tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch, locationId: selectedLocation?.id, locationName: selectedLocation?.name }) })
      if (serverDraftId.current) { apiFetch(`/api/drafts/${serverDraftId.current}`, { method: 'DELETE' }).catch(() => {}); serverDraftId.current = null }
      setText(''); setDate(''); setFiles([]); setYoutubeTitle(''); setYoutubeMadeForKids(''); setYoutubeCategoryId(''); setYoutubeFormat(''); setTiktokDisableComment(false); setTiktokDisableDuet(false); setTiktokDisableStitch(false); setSelectedLocation(null); setLocationQuery(''); setPublishNow(false); setSaved(true); localStorage.removeItem(AUTOSAVE_KEY); setDraftSavedAt(null); setServerDraftStatus('')
      if (publishNow && createdPost?.id) {
        setPublicationStatus({ type: 'processing', message: `Post #${createdPost.id} enviado. Aguardando confirmação das redes sociais...` })
        monitorPublication(createdPost.id, eventCursor)
      }
    } catch (caught) { setError(caught.message) } finally { setLoading(false); setProgress('') }
  }

  async function saveAsTemplate() {
    if (!text.trim()) { notify('Escreva algum conteúdo antes de salvar um modelo.', 'error'); return }
    try {
      await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Modelo de publicação', text, platforms: selected, isTemplate: true }) })
      notify('Modelo salvo nos seus rascunhos.')
    } catch (caught) {
      notify(caught.message, 'error')
    }
  }

  return <section className="page-view scheduler-page"><section className="panel scheduler-panel"><header className="scheduler-heading"><div><p className="eyebrow">PUBLICAÇÃO</p><h2>{publishNow ? 'Publicar agora' : 'Agendar publicação'}</h2><p>Prepare uma publicação e distribua para as redes selecionadas.</p></div>{(draftSavedAt || serverDraftStatus) && <span className="autosave-status" role="status">{serverDraftStatus || `Salvo localmente às ${draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span>}</header><div className="scheduler-workspace"><form className="draft-form sched-form" onSubmit={submit}>

    <SchedSection number={1} title="Plataformas">
      <div className="platform-options">{platforms.map(platform => {
        const connectedAccount = connectedAccounts.find(account => account.platform === platform)
        const accountLabel = connectedAccount?.handle || connectedAccount?.name
        const isSelected = selected.includes(platform)
        return <label className={`platform-option platform-option-${platform}`} key={platform}>
          <input type="checkbox" checked={isSelected} onChange={() => toggle(platform)} aria-label={`${isSelected ? 'Desmarcar' : 'Selecionar'} ${platform}`}/>
          <span className="platform-option-icon" aria-hidden="true"><PlatformIcon platform={platform} className="h-6 w-6"/></span>
          <span className="platform-option-name">{platform[0].toUpperCase() + platform.slice(1)}</span>
          <span className="platform-option-hint">{isSelected ? 'Selecionada' : 'Selecionar'}</span>
          <span className="platform-option-account">{accountLabel ? (accountLabel.startsWith('@') ? accountLabel : `@${accountLabel}`) : 'Nenhuma conta conectada'}</span>
          <span className="platform-option-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
        </label>
      })}</div>
    </SchedSection>

    <SchedSection number={2} title="Mídia e conteúdo">
      <div className="upload-field" onDragOver={event => event.preventDefault()} onDrop={dropFiles}>
        <div className="upload-field-heading"><div><p className="eyebrow">MÍDIAS</p><strong>Escolha os arquivos da publicação</strong></div><span aria-hidden="true">▧</span></div>
        <label className="upload-picker"><span className="upload-picker-icon" aria-hidden="true">↑</span><span className="upload-picker-copy"><strong>Escolher arquivo</strong><small>Imagem ou vídeo · você pode selecionar mais de um</small></span><input className="upload-picker-input" type="file" multiple accept="image/*,video/*" onChange={selectFiles} aria-label="Selecionar imagens ou vídeos"/></label>
        <p className="upload-drop-hint">ou arraste os arquivos até aqui · PNG, JPG, WEBP, MP4 e MOV</p>
      </div>
      {files.length > 0 && <div className="media-preview-grid" aria-label="Arquivos selecionados">{mediaPreviews.map(item => <article className="media-preview-card" key={item.key}>
        {item.file.type.startsWith('image/') ? <img src={item.url} alt={`Prévia de ${item.file.name}`} /> : <video className="media-video-thumb" src={item.url} muted playsInline preload="metadata" aria-label={`Prévia do vídeo ${item.file.name}`} />}
        <div className="media-preview-info"><strong title={item.file.name}>{item.file.name}</strong><small>{formatFileSize(item.file.size)}</small></div>
        <button type="button" className="media-remove-button" onClick={() => removeFile(item.key)} aria-label={`Remover ${item.file.name}`}>×</button>
      </article>)}</div>}
      <label><span className="post-text-label"><span>Descrição do post</span><MediaAiSuggestions files={files} selected={selected} contexto={text} previews={mediaPreviews} onApply={applyMediaSuggestion}/></span><textarea value={text} onChange={event => setText(event.target.value)} maxLength={5000} placeholder="Escreva a descrição do post ou gere com IA..." aria-label="Descrição do post" aria-describedby="post-text-help"/><span id="post-text-help" className="field-help"><span>A descrição gerada será inserida aqui e adaptada para cada rede.</span><span>{text.length}/5000</span></span></label>
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
        {selected.length === 0 && <p className="empty-state">Escolha ao menos uma rede acima para ver as opções específicas dela.</p>}
      </div>
    </SchedSection>

    <SchedSection number={4} title="Agendamento">
      <div className={`publish-now-card${publishNow ? ' is-active' : ''}`}>
        <div className="publish-now-copy"><span className="publish-now-icon" aria-hidden="true">⚡</span><div><strong>Publicar agora</strong><small>Envie para as redes assim que concluir a publicação.</small></div></div>
        <label className="mode-toggle"><input type="checkbox" checked={publishNow} onChange={event => setPublishNow(event.target.checked)}/><span>{publishNow ? 'Ativado' : 'Ativar'}</span></label>
      </div>
      {!publishNow && <label>Data e hora<input required type="datetime-local" value={date} onChange={event => setDate(event.target.value)}/></label>}
    </SchedSection>

    {issues.length > 0 && <div className="validation-panel" aria-live="polite"><p className="validation-panel-heading">⚠ {issues.length} {issues.length === 1 ? 'pendência' : 'pendências'} antes de {publishNow ? 'publicar' : 'agendar'}</p><ul className="validation-panel-list">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div>}
    <div className="scheduler-submit-actions"><button className="action-button" disabled={loading || issues.length > 0}>{loading ? progress || 'Processando...' : publishNow ? 'Publicar agora' : 'Agendar'}</button><button type="button" className="secondary-button" onClick={saveAsTemplate} disabled={loading || !text.trim()}>Salvar como modelo</button></div>
  </form><PostPreview text={text} selected={selected} files={files} previews={mediaPreviews} publishNow={publishNow} date={date} youtubeTitle={youtubeTitle} igFormat={igFormat} accounts={connectedAccounts}/></div>{saved && !publicationStatus && <p className="success-message">Publicação agendada.</p>}{publicationStatus && <p className={publicationStatus.type === 'error' ? 'error-message' : 'success-message'} role={publicationStatus.type === 'error' ? 'alert' : 'status'}>{publicationStatus.message}</p>}{error && <p className="error-message" role="alert">{error}</p>}</section></section>
}
