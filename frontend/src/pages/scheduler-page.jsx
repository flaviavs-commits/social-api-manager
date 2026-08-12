import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { buildValidationIssues, mediaFileKey, readVideoMeta } from '../lib/postValidation.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { createPostValidationWorker } from '../lib/postValidationWorker.js'
import { findPublicationResult, latestPublicationEventId, processingPublicationMessage, scheduledPublicationMessage } from '../lib/publicationEvents.js'
import { useToast } from '../components/ui/toast.jsx'
import { PLATFORM_TEXT_LIMITS, getPlatformTextLimit } from '../lib/platformTextLimits.js'
import { PREVIEW_ASPECTS, PREVIEW_ASPECT_OPTIONS, mediaKindLabel, ratioLabel, resolvePreviewAspect } from '../lib/mediaFormat.js'
import '../styles/scheduler-composer.css'

const platforms = ['instagram', 'facebook', 'youtube', 'tiktok']
const AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const AI_POST_DRAFT_KEY = 'meu-ecoo:ai-post-draft'

function formatFileSize(bytes) {
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`
}

function readImageMeta(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight, duration: null })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    image.src = url
  })
}

async function imageSourceToFile(source, fileName = 'imagem-gerada-ia.png') {
  const response = await fetch(source)
  if (!response.ok) throw new Error('Não foi possível carregar a imagem gerada pela IA.')
  const blob = await response.blob()
  const extension = blob.type.split('/')[1] || 'png'
  const safeName = fileName.includes('.') ? fileName : `${fileName}.${extension}`
  return new File([blob], safeName, { type: blob.type || 'image/png', lastModified: Date.now() })
}

const aiPlatformLabels = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
const MEDIA_AI_MODEL = 'openrouter'
const MEDIA_HASHTAG_LIMITS = { instagram: 5, facebook: 2, youtube: 3, tiktok: 2 }
const MEDIA_TEXT_LIMITS = { tiktok: 4000 }
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
  ].map(cleanAiTag).filter(Boolean))).slice(0, MEDIA_HASHTAG_LIMITS[suggestion.plataforma] || 3)
}

function trimAiCaption(value, max) {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

function composeAiCaption(suggestion) {
  const body = String(suggestion.texto || '').trim()
  const tags = uniqueAiTags(suggestion)
  const max = MEDIA_TEXT_LIMITS[suggestion.plataforma]
  if (!max) return [body, tags.length ? tags.map(tag => `#${tag}`).join(' ') : ''].filter(Boolean).join('\n\n')

  let caption = trimAiCaption(body, max)
  for (const tag of tags) {
    const separator = caption ? '\n\n' : ''
    const candidate = `${caption}${separator}#${tag}`
    if (candidate.length > max) break
    caption = candidate
  }
  return caption
}

function MediaAiSuggestions({ files, selected, contexto, previews, onApply }) {
  const [busy, setBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  async function analyzeMedia() {
    if (!files.length || !selected.length) return
    const requestedPlatforms = [...new Set(selected.filter(platform => platforms.includes(platform)))]
    if (!requestedPlatforms.length || requestedPlatforms.length > 4) {
      setAnalysisError('Selecione entre 1 e 4 redes sociais antes de gerar a descrição.')
      return
    }
    setBusy(true)
    setAnalysisError('')
    setSuccessMessage('')
    const targets = files.slice(0, 6)
    const settled = await Promise.allSettled(targets.map(async file => {
      const media = await buildMediaAnalysisPayload(file)
      const response = await apiFetch('/api/ai/analyze-media', {
        method: 'POST',
        body: JSON.stringify({ ...media, plataformas: requestedPlatforms, contexto, melhorar: Boolean(contexto.trim()), modelo: MEDIA_AI_MODEL }),
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
      const suggestions = requestedPlatforms
        .map(platform => firstResult.sugestoes?.find(item => item.plataforma === platform))
        .filter(Boolean)
      const missingPlatforms = requestedPlatforms.filter(platform => !suggestions.some(suggestion => suggestion.plataforma === platform))
      if (missingPlatforms.length) {
        setAnalysisError(`A IA não retornou uma sugestão para: ${missingPlatforms.join(', ')}. Tente novamente.`)
      } else {
        onApply(suggestions, { silent: true })
        setSuccessMessage(`${contexto.trim() ? 'Descrição melhorada' : 'Descrição gerada'} para ${suggestions.length} rede(s) selecionada(s).`)
      }
    }
    setBusy(false)
  }

  const ready = files.length > 0 && selected.length > 0

  return <section className="media-ai-generator" aria-label="Gerar descrição do post com inteligência artificial" aria-busy={busy}>
    <div className="media-ai-generator-icon" aria-hidden="true">✦</div>
    <div className="media-ai-generator-content">
      <div className="media-ai-generator-heading">
        <div>
          <p className="eyebrow">ASSISTENTE DE CONTEÚDO</p>
          <strong>Gere uma descrição para sua mídia</strong>
        </div>
        <span className={`media-ai-generator-state${busy ? ' is-loading' : ''}${successMessage ? ' is-success' : ''}`}>
          <i aria-hidden="true" />{busy ? 'Analisando' : successMessage ? 'Pronto' : 'IA visual'}
        </span>
      </div>
      <p className="media-ai-generator-copy">A IA observa a imagem ou o vídeo e preenche o texto de cada rede com uma sugestão pronta para revisar.</p>
      <div className="media-ai-generator-footer">
        <div className="media-ai-generator-hints" aria-live="polite">
          {!files.length && <span><b>1</b> Selecione uma imagem ou vídeo</span>}
          {!selected.length && <span><b>2</b> Selecione ao menos uma rede social</span>}
          {files.length > 6 && <span>As primeiras 6 mídias serão analisadas.</span>}
          {ready && !analysisError && !successMessage && <span className="media-ai-generator-ready">Pronto para analisar sua mídia.</span>}
          {analysisError && <span className="media-ai-generator-error" role="alert">{analysisError}</span>}
          {successMessage && <span className="media-ai-generator-success" role="status">✓ {successMessage}</span>}
        </div>
        <button type="button" className="media-ai-generator-button" onClick={analyzeMedia} disabled={busy || !ready}>
          <span aria-hidden="true">{busy ? '◌' : '✦'}</span>{busy ? 'Analisando mídia…' : contexto.trim() ? 'Melhorar descrição' : 'Gerar descrição'}
        </button>
      </div>
    </div>
  </section>
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

function previewAspectOptions(platform, instagramFormat) {
  if (platform === 'instagram' && ['reel', 'story'].includes(instagramFormat)) return [PREVIEW_ASPECTS.vertical]
  if (platform === 'instagram') return [PREVIEW_ASPECTS.square, PREVIEW_ASPECTS.portrait]
  if (platform === 'tiktok') return PREVIEW_ASPECT_OPTIONS
  return Object.values(PREVIEW_ASPECTS)
}

function PreviewMedia({ platform, previews, igFormat, aspectRequest, mediaProfile, accountHandle }) {
  const item = previews[0]
  const isVideo = item?.file.type.startsWith('video/')
  const aspect = resolvePreviewAspect({ platform, mediaKind: mediaProfile?.kind, sourceRatio: mediaProfile?.ratio, requested: aspectRequest, instagramFormat: igFormat })
  const aspectClass = `is-${aspect.key}`
  const mediaClass = isVideo ? 'is-video' : item ? 'is-photo' : ''
  if (!item) return <div className={`social-preview-media social-preview-media-${platform} ${aspectClass} ${mediaClass} is-empty`} style={{ '--preview-aspect': String(aspect.ratio) }}><span aria-hidden="true">＋</span><small>Adicione uma imagem ou vídeo</small></div>
  const media = isVideo
    ? <div className="social-preview-video"><video src={item.url} controls muted playsInline preload="metadata" aria-label="Prévia do vídeo selecionado"/><span className="social-preview-video-badge">Vídeo detectado</span></div>
    : <img src={item.url} alt="Prévia da publicação"/>
  return <div className={`social-preview-media social-preview-media-${platform} ${aspectClass} ${mediaClass}`} style={{ '--preview-aspect': String(aspect.ratio) }} data-media-kind={isVideo ? 'video' : 'image'} data-preview-aspect={aspect.label}>{media}{platform === 'instagram' && previews.length > 1 && <div className="social-preview-carousel-dots" aria-label={`${previews.length} mídias em carrossel`}>{previews.slice(0, 5).map((preview, index) => <span className={index === 0 ? 'is-active' : ''} key={preview.key}/>)}</div>}{platform === 'tiktok' && <div className="social-preview-tiktok-overlay"><strong>{accountHandle}</strong><span>♡ 0</span><span>💬 0</span><span>↗</span></div>}</div>
}

function PostPreview({ textByPlatform, titleByPlatform, selected, files, previews, publishNow, date, youtubeTitle, igFormat, igAspect, tiktokAspect, mediaProfile, accounts }) {
  const availablePlatforms = selected.length ? selected : platforms
  const [activePlatform, setActivePlatform] = useState(availablePlatforms[0])
  useEffect(() => {
    if (!availablePlatforms.includes(activePlatform)) setActivePlatform(availablePlatforms[0])
  }, [activePlatform, availablePlatforms.join(',')])
  const activeText = activePlatform === 'tiktok' ? (textByPlatform.tiktokDescription || '') : (textByPlatform[activePlatform] || '')
  const activeTitle = titleByPlatform[activePlatform] || ''
  const isYoutube = activePlatform === 'youtube'
  const isTiktok = activePlatform === 'tiktok'
  const isFacebook = activePlatform === 'facebook'
  const connectedAccount = accounts.find(account => account.platform === activePlatform)
  const rawHandle = connectedAccount?.handle || connectedAccount?.name || ''
  const accountLabel = rawHandle || 'Sua marca'
  const accountHandle = rawHandle ? (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`) : '@sua_marca'
  const requestedAspect = activePlatform === 'instagram' ? igAspect : activePlatform === 'tiktok' ? tiktokAspect : 'auto'
  const resolvedAspect = resolvePreviewAspect({ platform: activePlatform, mediaKind: mediaProfile?.kind, sourceRatio: mediaProfile?.ratio, requested: requestedAspect, instagramFormat: igFormat })
  const mediaLabel = mediaProfile ? `${mediaProfile.kind === 'video' ? 'Vídeo' : 'Foto'} · ${resolvedAspect.label}` : resolvedAspect.label
  const formatLabel = activePlatform === 'instagram' ? `${['reel', 'story'].includes(igFormat) ? (igFormat === 'reel' ? 'Reel' : 'Story') : 'Feed'} · ${mediaLabel}` : activePlatform === 'youtube' ? `Thumbnail · ${mediaLabel}` : activePlatform === 'tiktok' ? `TikTok · ${mediaLabel}` : `Feed · ${mediaLabel}`
  return <aside className="post-preview" aria-label="Pré-visualização da publicação">
    <div className="post-preview-heading"><div><p className="eyebrow">PREVIEW REALISTA</p><h3>Veja em cada rede</h3></div><span className="post-preview-status">{publishNow ? 'Agora' : date ? 'Agendada' : 'Rascunho'}</span></div>
    <div className="preview-network-tabs" role="tablist" aria-label="Prévia por rede social">{availablePlatforms.map(platform => <button type="button" role="tab" aria-selected={activePlatform === platform} className={`preview-network-tab preview-network-tab-${platform}${activePlatform === platform ? ' is-active' : ''}`} key={platform} onClick={() => setActivePlatform(platform)}><span className="preview-network-tab-icon"><PlatformIcon platform={platform} className="h-4 w-4"/></span>{previewLabels[platform]}</button>)}</div>
    <div className="social-preview-format"><span>Formato simulado</span><strong>{formatLabel}</strong></div><div className="social-preview-detection" role="status"><span className={mediaProfile?.kind === 'video' ? 'is-video' : 'is-image'}>{mediaProfile ? mediaKindLabel(mediaProfile.kind) : 'Aguardando mídia'}</span><small>{mediaProfile?.ratio ? `Original ${ratioLabel(mediaProfile.width, mediaProfile.height)}` : 'A proporção será detectada ao adicionar a mídia.'}</small></div><div className={`social-preview-card social-preview-card-${activePlatform}`}>
      <div className="social-preview-account"><span className={`social-preview-avatar social-preview-avatar-${activePlatform}`}>{connectedAccount?.avatarUrl ? <img src={connectedAccount.avatarUrl} alt=""/> : <PlatformIcon platform={activePlatform} className="h-4 w-4"/>}</span><div><strong>{accountLabel}</strong><small>{previewLabels[activePlatform]} · agora</small></div><span className="social-preview-more" aria-hidden="true">•••</span></div>
      {isYoutube ? <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-youtube-copy"><strong>{youtubeTitle || activeText || 'Título do seu vídeo aparecerá aqui'}</strong><small>{accountLabel} · 0 visualizações · agora</small></div></> : isTiktok ? <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-tiktok-copy"><strong>{activeTitle || 'Adicione um título para o TikTok'}</strong><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'A descrição da sua publicação aparecerá aqui.'}</p></div></> : isFacebook ? <><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'O texto da sua publicação aparecerá aqui.'}</p><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-actions"><span>♡</span><span>◯</span><span>↗</span><small>{files.length ? `${files.length} mídia${files.length > 1 ? 's' : ''}` : 'Sem mídia'}</small></div></> : <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-actions"><span>♡</span><span>◯</span><span>↗</span><small>{files.length ? `${files.length} mídia${files.length > 1 ? 's' : ''}` : 'Sem mídia'}</small></div><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'O texto da sua publicação aparecerá aqui.'}</p></>}
    </div>
    <p className="post-preview-hint">A prévia simula a estrutura visual da rede. O resultado final pode variar conforme o formato e a conta.</p>
  </aside>
}

export function SchedulerPage() {
  const [textByPlatform, setTextByPlatform] = useState({})
  const [titleByPlatform, setTitleByPlatform] = useState({})
  const [date, setDate] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [selected, setSelected] = useState(['instagram'])
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [files, setFiles] = useState([])
  const [mediaPreviews, setMediaPreviews] = useState([])
  const [mediaMetaByKey, setMediaMetaByKey] = useState({})
  const [videoMetaByKey, setVideoMetaByKey] = useState({})
  const [youtubeTitle, setYoutubeTitle] = useState('')
  const [youtubeVisibility, setYoutubeVisibility] = useState('public')
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState('')
  const [igFormat, setIgFormat] = useState('post')
  const [igAspect, setIgAspect] = useState('auto')
  const [tiktokAspect, setTiktokAspect] = useState('auto')
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('PUBLIC_TO_EVERYONE')
  const [tiktokDisableComment, setTiktokDisableComment] = useState(false)
  const [tiktokDisableDuet, setTiktokDisableDuet] = useState(false)
  const [tiktokDisableStitch, setTiktokDisableStitch] = useState(false)
  const [youtubeCategoryId, setYoutubeCategoryId] = useState('')
  const [youtubeFormat, setYoutubeFormat] = useState('')
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [publicationStatus, setPublicationStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [workerIssues, setWorkerIssues] = useState([])
  const [draftReady, setDraftReady] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState(null)
  const [serverDraftStatus, setServerDraftStatus] = useState('')
  const notify = useToast()
  const validationRequest = useRef(0)
  const publicationPollTimer = useRef(null)

  useEffect(() => {
    if (['reel', 'story'].includes(igFormat) && igAspect !== 'auto') setIgAspect('auto')
    if (igFormat === 'post' && !['auto', 'square', 'portrait'].includes(igAspect)) setIgAspect('auto')
  }, [igFormat, igAspect])
  const serverDraftId = useRef(null)
  const validationWorker = useMemo(() => createPostValidationWorker(({ requestId, issues }) => {
    if (requestId === validationRequest.current) setWorkerIssues(issues)
  }), [])

  useEffect(() => {
    apiFetch('/api/accounts').then(data => setConnectedAccounts(data.data || [])).catch(() => setConnectedAccounts([]))
  }, [])

  useEffect(() => {
    let selection = null
    try {
      selection = JSON.parse(sessionStorage.getItem('meu-ecoo:media-library-selection') || 'null')
      sessionStorage.removeItem('meu-ecoo:media-library-selection')
    } catch { selection = null }
    if (!selection?.url) return undefined

    let cancelled = false
    fetch(selection.url).then(response => {
      if (!response.ok) throw new Error('A mídia salva não está disponível neste momento.')
      return response.blob()
    }).then(blob => {
      if (cancelled) return
      const type = selection.mimeType || blob.type || 'application/octet-stream'
      const file = new File([blob], selection.name || 'midia-da-biblioteca', { type, lastModified: Date.now() })
      setFiles(current => [...current, file])
      notify(`“${selection.name || 'Mídia'}” carregada do acervo.`)
    }).catch(error => {
      if (!cancelled) notify(error.message || 'Não foi possível carregar a mídia salva.', 'error')
    })
    return () => { cancelled = true }
  }, [notify])

  useEffect(() => () => {
    validationWorker?.terminate()
    clearTimeout(publicationPollTimer.current)
  }, [validationWorker])

  useEffect(() => {
    try {
      const savedDraft = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null')
      if (savedDraft) {
        const savedSelected = savedDraft.selected?.length ? savedDraft.selected : ['instagram']
        const savedText = typeof savedDraft.text === 'string' ? savedDraft.text : ''
        const savedTexts = savedDraft.textByPlatform && typeof savedDraft.textByPlatform === 'object' ? savedDraft.textByPlatform : {}
        const savedTitles = savedDraft.titleByPlatform && typeof savedDraft.titleByPlatform === 'object' ? savedDraft.titleByPlatform : {}
        const migratedTexts = Object.fromEntries(savedSelected.filter(platform => platform !== 'tiktok').map(platform => [platform, Object.prototype.hasOwnProperty.call(savedTexts, platform) ? savedTexts[platform] : savedText]))
        const { tiktok: legacyTiktokText, ...savedTextsWithoutLegacyTiktok } = savedTexts
        setTextByPlatform({
          ...savedTextsWithoutLegacyTiktok,
          ...migratedTexts,
          ...(savedTexts.tiktokDescription || legacyTiktokText ? { tiktokDescription: savedTexts.tiktokDescription || legacyTiktokText } : {})
        })
        setTitleByPlatform(savedTitles)
        setDate(savedDraft.date || '')
        setPublishNow(Boolean(savedDraft.publishNow))
        setSelected(savedSelected)
        setYoutubeTitle(savedDraft.youtubeTitle || '')
        setYoutubeVisibility(savedDraft.youtubeVisibility || 'public')
        setYoutubeMadeForKids(savedDraft.youtubeMadeForKids || '')
        setIgFormat(savedDraft.igFormat || 'post')
        setIgAspect(savedDraft.igAspect || 'auto')
        setTiktokAspect(savedDraft.tiktokAspect || 'auto')
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
      const hasContent = Object.values(textByPlatform).some(value => value?.trim()) || Object.values(titleByPlatform).some(value => value?.trim()) || youtubeTitle.trim() || files.length
      if (!hasContent) {
        localStorage.removeItem(AUTOSAVE_KEY)
        setDraftSavedAt(null)
        return
      }
      const savedAt = new Date()
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ textByPlatform, titleByPlatform, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, igFormat, igAspect, tiktokAspect, tiktokPrivacyLevel, savedAt: savedAt.toISOString() }))
      setDraftSavedAt(savedAt)
    }, 700)
    return () => clearTimeout(timer)
  }, [draftReady, textByPlatform, titleByPlatform, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, igFormat, igAspect, tiktokAspect, tiktokPrivacyLevel, files.length])

  useEffect(() => {
    if (!draftReady) return undefined
    const hasContent = Object.values(textByPlatform).some(value => value?.trim()) || Object.values(titleByPlatform).some(value => value?.trim()) || youtubeTitle.trim() || files.length
    if (!hasContent) return undefined
    const timer = setTimeout(async () => {
      try {
        if (serverDraftId.current) {
          await apiFetch(`/api/drafts/${serverDraftId.current}`, { method: 'PATCH', body: JSON.stringify({ textByPlatform, titleByPlatform, platforms: selected }) })
        } else {
          const result = await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Autosave', textByPlatform, titleByPlatform, platforms: selected }) })
          serverDraftId.current = result.id
        }
        setServerDraftStatus('Sincronizado na conta')
      } catch {
        setServerDraftStatus('Salvo somente neste dispositivo')
      }
    }, 1800)
    return () => clearTimeout(timer)
  }, [draftReady, textByPlatform, titleByPlatform, selected, youtubeTitle, files.length])

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
  function updatePlatformText(platform, value) {
    const key = platform === 'tiktok' ? 'tiktokDescription' : platform
    setTextByPlatform(current => ({ ...current, [key]: value }))
  }
  function updatePlatformTitle(platform, value) {
    setTitleByPlatform(current => ({ ...current, [platform]: value }))
  }
  function insertTiktokToken(token) {
    const current = textByPlatform.tiktokDescription || ''
    const separator = current && !/\s$/.test(current) ? ' ' : ''
    updatePlatformText('tiktok', `${current}${separator}${token}`.slice(0, 4000))
  }
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
  useEffect(() => {
    let draft = window.__socialAiPostDraft || null
    try {
      if (!draft) draft = JSON.parse(sessionStorage.getItem(AI_POST_DRAFT_KEY) || 'null')
      sessionStorage.removeItem(AI_POST_DRAFT_KEY)
    } catch {}
    window.__socialAiPostDraft = null
    if (!draft?.image) return undefined

    let cancelled = false
    setTextByPlatform(draft.text ? { instagram: draft.text } : {})
    imageSourceToFile(draft.image).then(file => {
      if (!cancelled) addFiles([file])
    }).catch(error => {
      if (!cancelled) setError(error.message)
    })
    return () => { cancelled = true }
  }, [])
  function applyMediaSuggestion(suggestionOrSuggestions, options = {}) {
    const suggestions = Array.isArray(suggestionOrSuggestions) ? suggestionOrSuggestions : [suggestionOrSuggestions]
    suggestions.filter(Boolean).forEach(suggestion => {
      const composedText = composeAiCaption(suggestion)
      if (suggestion.plataforma) updatePlatformText(suggestion.plataforma, composedText)
      if (suggestion.plataforma === 'youtube' && suggestion.titulo) setYoutubeTitle(suggestion.titulo)
    })
    if (!options.silent && suggestions.length) {
      const labels = suggestions.map(suggestion => aiPlatformLabels[suggestion.plataforma] || suggestion.plataforma).filter(Boolean).join(', ')
      notify(`Sugestão aplicada para ${labels}.`)
    }
  }

  // Lê a dimensão real de imagens e vídeos para identificar automaticamente
  // o tipo da mídia e escolher a proporção mais próxima na prévia.
  useEffect(() => {
    let cancelled = false
    Promise.all(files.map(async file => {
      const key = mediaFileKey(file)
      const meta = file.type.startsWith('video/') ? await readVideoMeta(file) : await readImageMeta(file)
      return [key, meta ? { ...meta, kind: file.type.startsWith('video/') ? 'video' : 'image' } : null]
    })).then(entries => {
      if (!cancelled) setMediaMetaByKey(Object.fromEntries(entries.filter(([, meta]) => meta)))
    })
    return () => { cancelled = true }
  }, [files])

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

  const mediaProfile = useMemo(() => {
    const firstFile = files[0]
    if (!firstFile) return null
    const meta = mediaMetaByKey[mediaFileKey(firstFile)]
    return {
      kind: meta?.kind || (firstFile.type.startsWith('video/') ? 'video' : 'image'),
      width: meta?.width || 0,
      height: meta?.height || 0,
      ratio: meta?.width && meta?.height ? meta.width / meta.height : null,
    }
  }, [files, mediaMetaByKey])

  const validationInput = {
    textByPlatform, titleByPlatform, tiktokDescription: textByPlatform.tiktokDescription || '', platforms: selected, files: files.map(({ name, lastModified, size, type }) => ({ name, lastModified, size, type })),
    publishNow, scheduledAt: date, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey
  }
  useEffect(() => {
    const requestId = ++validationRequest.current
    if (!validationWorker) {
      setWorkerIssues(buildValidationIssues(validationInput))
      return
    }
    validationWorker.postMessage({ ...validationInput, requestId })
  }, [validationWorker, textByPlatform, titleByPlatform, selected, files, publishNow, date, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey])
  const issues = workerIssues

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
    event.preventDefault(); setError(''); setSavedMessage(''); setPublicationStatus(null); setProgress('')
    if (issues.length > 0) { setError(issues[0].message); return }
    setLoading(true)
    try {
      const eventCursor = publishNow ? await latestPublicationEventId(apiFetch) : 0
      setProgress(files.length ? 'Enviando mídias...' : 'Validando agendamento...')
      const media = await uploadWithConcurrency(files, uploadFile, 3, (completed, total) => setProgress(`Enviando mídias (${completed}/${total})...`))
      const scheduledAt = publishNow ? new Date().toISOString() : date
      const platformTexts = Object.fromEntries(Object.entries(textByPlatform).filter(([platform]) => selected.includes(platform)))
      setProgress(publishNow ? 'Preparando publicação imediata...' : 'Processando e salvando agendamento...')
       const createdPost = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ textByPlatform: JSON.stringify(platformTexts), titleByPlatform: JSON.stringify(titleByPlatform), scheduledAt, platforms: JSON.stringify(selected), publishNow, media: JSON.stringify(media), youtubeTitle, youtubeVisibility, youtubeMadeForKids: youtubeMadeForKids === '' ? undefined : youtubeMadeForKids === 'true', youtubeCategoryId: youtubeCategoryId || undefined, youtubeFormat: youtubeFormat || undefined, igFormat, tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch }) })
      if (serverDraftId.current) { apiFetch(`/api/drafts/${serverDraftId.current}`, { method: 'DELETE' }).catch(() => {}); serverDraftId.current = null }
      const successMessage = publishNow ? '' : scheduledPublicationMessage(date, selected)
       setTextByPlatform({}); setTitleByPlatform({}); setDate(''); setFiles([]); setYoutubeTitle(''); setYoutubeMadeForKids(''); setYoutubeCategoryId(''); setYoutubeFormat(''); setTiktokDisableComment(false); setTiktokDisableDuet(false); setTiktokDisableStitch(false); setPublishNow(false); setSavedMessage(successMessage); localStorage.removeItem(AUTOSAVE_KEY); setDraftSavedAt(null); setServerDraftStatus('')
      if (publishNow && createdPost?.id) {
        setPublicationStatus({ type: 'processing', message: processingPublicationMessage(selected) })
        monitorPublication(createdPost.id, eventCursor)
      }
    } catch (caught) { setError(caught.message) } finally { setLoading(false); setProgress('') }
  }

  async function saveAsTemplate() {
    if (!Object.values(textByPlatform).some(value => value?.trim())) { notify('Escreva algum conteúdo antes de salvar um modelo.', 'error'); return }
    try {
      await apiFetch('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Modelo de publicação', textByPlatform, titleByPlatform, platforms: selected, isTemplate: true }) })
      notify('Modelo salvo nos seus rascunhos.')
    } catch (caught) {
      notify(caught.message, 'error')
    }
  }

  const aiContext = selected.map(platform => {
    const value = platform === 'tiktok' ? (textByPlatform.tiktokDescription || '') : (textByPlatform[platform] || '')
    return value.trim() ? `${aiPlatformLabels[platform] || platform}: ${value.trim()}` : ''
  }).filter(Boolean).join('\n\n')

  const tiktokPreviewAspect = resolvePreviewAspect({ platform: 'tiktok', mediaKind: mediaProfile?.kind, sourceRatio: mediaProfile?.ratio, requested: tiktokAspect, instagramFormat: igFormat })

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
        <div className="upload-field-heading"><div><p className="eyebrow">{mediaProfile?.kind === 'video' ? 'VÍDEO' : mediaProfile?.kind === 'image' ? 'FOTO' : selected.includes('tiktok') ? 'FOTOS' : 'MÍDIAS'}</p><strong>{mediaProfile?.kind === 'video' ? 'Vídeo detectado' : mediaProfile?.kind === 'image' ? 'Foto detectada' : selected.includes('tiktok') ? 'Fotos' : 'Escolha os arquivos da publicação'}</strong></div><span aria-hidden="true">▧</span></div>
        <label className="upload-picker"><span className="upload-picker-icon" aria-hidden="true">↑</span><span className="upload-picker-copy"><strong>{selected.includes('tiktok') ? 'Adicionar fotos' : 'Escolher arquivo'}</strong><small>Imagem ou vídeo · você pode selecionar mais de um</small></span><input className="upload-picker-input" type="file" multiple accept="image/*,video/*" onChange={selectFiles} aria-label="Selecionar imagens ou vídeos"/></label>
        <p className="upload-drop-hint">ou arraste os arquivos até aqui · PNG, JPG, WEBP, MP4 e MOV</p>
      </div>
      {files.length > 0 && <div className={`media-preview-grid${selected.includes('tiktok') ? ' media-preview-grid-tiktok' : ''}`} aria-label="Arquivos selecionados">{mediaPreviews.map((item, index) => <article className="media-preview-card" key={item.key}>
        {selected.includes('tiktok') && index === 0 && <span className="media-cover-badge">Capa</span>}
        {item.file.type.startsWith('image/') ? <img src={item.url} alt={`Prévia de ${item.file.name}`} /> : <video className="media-video-thumb" src={item.url} muted playsInline preload="metadata" aria-label={`Prévia do vídeo ${item.file.name}`} />}
        <div className="media-preview-info"><strong title={item.file.name}>{item.file.name}</strong><small>{item.file.type.startsWith('video/') ? 'Vídeo' : 'Foto'} · {formatFileSize(item.file.size)}</small></div>
        <button type="button" className="media-remove-button" onClick={() => removeFile(item.key)} aria-label={`Remover ${item.file.name}`}>×</button>
      </article>)}{selected.includes('tiktok') && <label className="media-add-card"><span aria-hidden="true">＋</span><small>Adicionar</small><input className="upload-picker-input" type="file" multiple accept="image/*,video/*" onChange={selectFiles} aria-label="Adicionar fotos ao TikTok"/></label>}</div>}
      {mediaProfile && <div className="media-detection-panel" role="status"><div><strong>{mediaKindLabel(mediaProfile.kind)}</strong><span>{mediaProfile.ratio ? `Original ${ratioLabel(mediaProfile.width, mediaProfile.height)}` : 'Lendo a proporção original…'}</span></div><small>{mediaProfile.width && mediaProfile.height ? `${mediaProfile.width} × ${mediaProfile.height}px` : 'A prévia será ajustada automaticamente.'}</small></div>}
      {selected.length > 0 && <div className="platform-text-editors" aria-label="Textos e configurações específicas por rede"><div className="platform-text-editors-heading"><strong>Texto de cada rede</strong><span>Cada cartão reúne o conteúdo e as configurações da própria rede.</span></div><div className="platform-composer-list">{selected.map(platform => {
        const platformLabel = PLATFORM_TEXT_LIMITS[platform]?.label || aiPlatformLabels[platform] || platform
        const connectedAccount = connectedAccounts.find(account => account.platform === platform)
        const accountLabel = connectedAccount?.handle || connectedAccount?.name
        const limit = getPlatformTextLimit(platform)
        const value = textByPlatform[platform] || ''
        return <article className={`platform-composer-card platform-composer-card-${platform}`} key={platform}>
          <header className="platform-composer-card-heading"><span className="platform-composer-card-icon"><PlatformIcon platform={platform} className="h-5 w-5"/></span><div><strong>{platformLabel}</strong><small>{accountLabel ? (accountLabel.startsWith('@') ? accountLabel : `@${accountLabel}`) : 'Nenhuma conta conectada'}</small></div><span className={`platform-composer-account-state ${accountLabel ? 'is-connected' : 'is-pending'}`}>{accountLabel ? 'Conta conectada' : 'Conta pendente'}</span>{platform === 'tiktok' && <span className="platform-composer-badge">{tiktokPreviewAspect.label}</span>}</header>
          <div className="platform-composer-content"><div className="platform-composer-content-heading"><strong>Conteúdo da publicação</strong><span>{platform === 'tiktok' ? 'Título e descrição do TikTok.' : `Texto exclusivo para ${platformLabel}.`}</span></div>
          {platform === 'tiktok' ? <div className="platform-composer-tiktok-fields">
            <label className="tiktok-title-field"><span><span>Título chamativo</span><small>{(titleByPlatform.tiktok || '').length}/90</small></span><input value={titleByPlatform.tiktok || ''} onChange={event => updatePlatformTitle('tiktok', event.target.value)} maxLength={90} placeholder="Adicione um título chamativo" aria-label="Título chamativo do TikTok"/></label>
            <label className="tiktok-description-field"><span><span>Descrição</span><small>{(textByPlatform.tiktokDescription || '').length}/4000</small></span><textarea value={textByPlatform.tiktokDescription || ''} onChange={event => updatePlatformText('tiktok', event.target.value)} maxLength={4000} placeholder="Escrever uma descrição longa pode ajudar a obter, em média, 3x mais visualizações" aria-label="Descrição do TikTok"/><span className="tiktok-description-actions"><button type="button" onClick={() => insertTiktokToken('#')}># Hashtags</button><button type="button" onClick={() => insertTiktokToken('@')}>@ Mencionar</button></span></label>
          </div> : <label className={`platform-text-editor platform-text-editor-${platform}`}><span className="platform-text-editor-label"><span>{platformLabel}</span><span>{value.length}/{limit} caracteres</span></span><textarea value={value} onChange={event => updatePlatformText(platform, event.target.value)} maxLength={limit} placeholder={`Escreva o texto do ${platformLabel}...`} aria-label={`Texto específico do ${platformLabel}`}/><small>Este conteúdo é enviado somente para o {platformLabel}.</small></label>}
          </div><section className="platform-composer-settings" aria-label={`Configurações do ${platformLabel}`}><div className="platform-composer-settings-heading"><div><strong>Configurações da rede</strong><span>Ajustes aplicados somente ao {platformLabel}.</span></div><span className="platform-composer-settings-scope">Somente {platformLabel}</span></div>
            {platform === 'instagram' && <div className="platform-composer-settings-grid"><label>Formato Instagram<select value={igFormat} onChange={event => setIgFormat(event.target.value)}><option value="post">Feed</option><option value="reel">Reel</option><option value="story">Story</option></select></label><label>Proporção da prévia Instagram<select value={igAspect} onChange={event => setIgAspect(event.target.value)}>{igFormat === 'post' && <><option value="auto">Automático · detectar</option><option value="square">Foto · 1:1</option><option value="portrait">Foto · 3:4</option></>}{['reel', 'story'].includes(igFormat) && <option value="vertical">Vídeo vertical · 9:16</option>}</select></label></div>}
            {platform === 'facebook' && <p className="platform-composer-no-settings">O Facebook aceita texto, imagem ou vídeo sem configurações adicionais nesta publicação.</p>}
            {platform === 'youtube' && <div className="platform-composer-settings-grid"><label>Título do YouTube<input value={youtubeTitle} onChange={event => setYoutubeTitle(event.target.value)} maxLength={100}/></label><label>Visibilidade<select value={youtubeVisibility} onChange={event => setYoutubeVisibility(event.target.value)}><option value="public">Público</option><option value="unlisted">Não listado</option><option value="private">Privado</option></select></label><label>Feito para crianças (YouTube)<select value={youtubeMadeForKids} onChange={event => setYoutubeMadeForKids(event.target.value)}><option value="">Selecione...</option><option value="false">Não</option><option value="true">Sim</option></select></label><label>Categoria do YouTube<select value={youtubeCategoryId} onChange={event => setYoutubeCategoryId(event.target.value)}><option value="">Automática</option>{youtubeCategories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label><label>Formato do YouTube<select value={youtubeFormat} onChange={event => setYoutubeFormat(event.target.value)}><option value="">Automático</option><option value="video">Vídeo</option><option value="short">Short</option></select></label></div>}
            {platform === 'tiktok' && <div className="platform-composer-settings-grid"><label>Proporção da prévia TikTok<select value={tiktokAspect} onChange={event => setTiktokAspect(event.target.value)}><option value="auto">Automático · detectar</option>{previewAspectOptions('tiktok', igFormat).map(option => <option value={option.key} key={option.key}>{option.key === 'vertical' ? 'Vídeo · ' : 'Foto · '}{option.label}</option>)}</select></label><label>Privacidade TikTok<select value={tiktokPrivacyLevel} onChange={event => setTiktokPrivacyLevel(event.target.value)}><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="SELF_ONLY">Somente eu</option></select></label><fieldset className="checkbox-group"><legend>Interações do TikTok</legend><div className="checkbox-row"><label><input type="checkbox" checked={tiktokDisableComment} onChange={event => setTiktokDisableComment(event.target.checked)}/> Bloquear comentários</label><label><input type="checkbox" checked={tiktokDisableDuet} onChange={event => setTiktokDisableDuet(event.target.checked)}/> Bloquear duet</label><label><input type="checkbox" checked={tiktokDisableStitch} onChange={event => setTiktokDisableStitch(event.target.checked)}/> Bloquear stitch</label></div></fieldset></div>}
          </section>
        </article>
      })}</div></div>}
      <MediaAiSuggestions files={files} selected={selected} contexto={aiContext} previews={mediaPreviews} onApply={applyMediaSuggestion}/>
    </SchedSection>

    <SchedSection number={3} title="Agendamento">
      <div className={`publish-now-card${publishNow ? ' is-active' : ''}`}>
        <div className="publish-now-copy"><span className="publish-now-icon" aria-hidden="true">⚡</span><div><strong>Publicar agora</strong><small>Envie para as redes assim que concluir a publicação.</small></div></div>
        <label className="mode-toggle"><input type="checkbox" checked={publishNow} onChange={event => setPublishNow(event.target.checked)}/><span>{publishNow ? 'Ativado' : 'Ativar'}</span></label>
      </div>
      {!publishNow && <label>Data e hora<input required type="datetime-local" value={date} onChange={event => setDate(event.target.value)}/></label>}
    </SchedSection>

    {issues.length > 0 && <div className="validation-panel" aria-live="polite"><p className="validation-panel-heading">⚠ {issues.length} {issues.length === 1 ? 'pendência' : 'pendências'} antes de {publishNow ? 'publicar' : 'agendar'}</p><ul className="validation-panel-list">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div>}
    <div className="scheduler-submit-actions"><button className="action-button" disabled={loading || issues.length > 0}>{loading ? progress || 'Processando...' : publishNow ? 'Publicar agora' : 'Agendar'}</button><button type="button" className="secondary-button" onClick={saveAsTemplate} disabled={loading || !Object.values(textByPlatform).some(value => value?.trim())}>Salvar como modelo</button></div>
  </form><PostPreview textByPlatform={textByPlatform} titleByPlatform={titleByPlatform} selected={selected} files={files} previews={mediaPreviews} publishNow={publishNow} date={date} youtubeTitle={youtubeTitle} igFormat={igFormat} igAspect={igAspect} tiktokAspect={tiktokAspect} mediaProfile={mediaProfile} accounts={connectedAccounts}/></div>{savedMessage && !publicationStatus && <p className="success-message">{savedMessage}</p>}{publicationStatus && <p className={publicationStatus.type === 'error' ? 'error-message' : 'success-message'} role={publicationStatus.type === 'error' ? 'alert' : 'status'}>{publicationStatus.message}</p>}{error && <p className="error-message" role="alert">{error}</p>}</section></section>
}
