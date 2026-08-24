import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { buildValidationIssues, INSTAGRAM_CAROUSEL_MAX_ITEMS, mediaFileKey, readVideoMeta } from '../lib/postValidation.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { createPostValidationWorker } from '../lib/postValidationWorker.js'
import { findPublicationResult, latestPublicationEventId, processingPublicationMessage, scheduledPublicationDetails } from '../lib/publicationEvents.js'
import { useToast } from '../components/ui/toast.jsx'
import { PLATFORM_TEXT_LIMITS, getPlatformTextLimit } from '../lib/platformTextLimits.js'
import { PREVIEW_ASPECTS, PREVIEW_ASPECT_OPTIONS, SOCIAL_MEDIA_RESOLUTIONS, TIKTOK_VIDEO_DIMENSIONS, mediaKindLabel, ratioLabel, resolvePreviewAspect, socialMediaResolutionHint } from '../lib/mediaFormat.js'
import { accountIdKey, accountsForPlatform, buildAccountSelectionIssues, groupAccountsByPerson, selectedAccountsForPost } from '../lib/account-selection.js'
import '../styles/scheduler-composer.css'

const platforms = ['instagram', 'facebook', 'youtube', 'tiktok']
const platformLabels = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
const AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const AI_POST_DRAFT_KEY = 'meu-ecoo:ai-post-draft'
const IMAGE_MIME_BY_EXTENSION = { heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp' }

function normalizeMediaFile(file) {
  if (file.type) return file
  const extension = file.name.split('.').pop()?.toLowerCase()
  const type = IMAGE_MIME_BY_EXTENSION[extension]
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file
}

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
  const dataUrl = canvas.toDataURL('image/jpeg', 0.62)
  return { mediaBase64: dataUrl.split(',')[1], mimeType: 'image/jpeg' }
}

function compressImageForAnalysis(file) {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const maxDimension = 768
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

function captureVideoFramesForAnalysis(file) {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    let finished = false
    const cleanup = () => { URL.revokeObjectURL(sourceUrl); video.removeAttribute('src'); video.load() }
    const fail = error => { if (!finished) { finished = true; cleanup(); reject(error) } }
    let frameTimes = []
    let frameIndex = 0
    let duration = 0
    const frames = []
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      try {
        duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
        // Um único frame no meio do vídeo não representa uma ação. Amostramos
        // o começo, o desenvolvimento e o encerramento para a IA entender a
        // sequência sem precisar enviar o arquivo de vídeo inteiro.
        const percentages = duration > 8 ? [0.04, 0.28, 0.52, 0.76, 0.96] : [0.05, 0.35, 0.65, 0.95]
        frameTimes = Array.from(new Set(percentages.map(percent => Math.min(Math.max(duration * percent, 0), Math.max(duration - 0.05, 0)))))
        video.currentTime = frameTimes[0] || 0
      } catch { fail(new Error(`Não foi possível preparar ${file.name}.`)) }
    }
    video.onseeked = () => {
      if (finished) return
      try {
        const maxDimension = 768
        const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        const frame = { ...canvasToAnalysisData(canvas), mediaKind: 'video', timestamp: frameTimes[frameIndex] || 0, frameIndex: frameIndex + 1, frameCount: frameTimes.length, duration }
        frames.push(frame)
        frameIndex += 1
        if (frameIndex < frameTimes.length) {
          video.currentTime = frameTimes[frameIndex]
          return
        }
        finished = true
        resolve({ frames, duration })
        cleanup()
      } catch { fail(new Error(`Não foi possível capturar um frame de ${file.name}.`)) }
    }
    video.onerror = () => fail(new Error(`Não foi possível ler ${file.name}.`))
    video.src = sourceUrl
    video.load()
  })
}

async function buildMediaAnalysisPayload(file) {
  if (!file.type.startsWith('video/')) return compressImageForAnalysis(file)
  const result = await captureVideoFramesForAnalysis(file)
  return result.frames
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
  const [analysisNotes, setAnalysisNotes] = useState([])
  const analysisLimit = selected.includes('instagram') && !selected.includes('tiktok') ? INSTAGRAM_CAROUSEL_MAX_ITEMS : 1

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
    setAnalysisNotes([])
    try {
      // Envia a sequência inteira em uma única análise para a IA entender a
      // narrativa do carrossel, escolher a melhor capa e evitar uma legenda
      // baseada apenas na primeira foto.
      const targets = files.slice(0, analysisLimit)
      const payloads = await Promise.all(targets.map(buildMediaAnalysisPayload))
      const mediaItems = payloads.flat().slice(0, 35)
      const hasVideo = targets.some(file => file.type.startsWith('video/'))
      const isCarousel = !hasVideo && targets.length > 1
      const response = await apiFetch('/api/ai/analyze-media', {
        method: 'POST',
        body: JSON.stringify({
          mediaItems,
          mediaKind: hasVideo ? 'video' : 'image',
          mediaCount: targets.length,
          videoFrameCount: hasVideo ? mediaItems.filter(item => item.mediaKind === 'video').length : 0,
          carousel: isCarousel,
          plataformas: requestedPlatforms,
          contexto,
          melhorar: Boolean(contexto.trim()),
          modelo: MEDIA_AI_MODEL,
        }),
      })
      const suggestions = requestedPlatforms
        .map(platform => response.sugestoes?.find(item => item.plataforma === platform))
        .filter(Boolean)
      const missingPlatforms = requestedPlatforms.filter(platform => !suggestions.some(suggestion => suggestion.plataforma === platform))
      if (missingPlatforms.length) {
        setAnalysisError(`A IA não retornou uma sugestão para: ${missingPlatforms.join(', ')}. Tente novamente.`)
      } else {
        onApply(suggestions, { silent: true })
        setAnalysisNotes([
          response.descricao_midia,
          ...(response.analise_carrossel?.recomendacoes || []),
        ].filter(Boolean))
        const mediaLabel = hasVideo ? (mediaItems.length > 1 ? `${mediaItems.length} cenas do vídeo` : 'o vídeo') : `${targets.length} ${targets.length === 1 ? 'mídia' : 'fotos'}`
        setSuccessMessage(`${contexto.trim() ? 'Descrição melhorada' : 'Descrição gerada'} considerando ${mediaLabel} para ${suggestions.length} rede(s).`)
      }
    } catch (caught) {
      const message = caught?.message || ''
      setAnalysisError(message.includes('limite') || message.includes('429')
        ? 'O modelo de IA atingiu o limite de requisições. Tente novamente em instantes.'
        : 'As imagens não puderam ser analisadas. Confira os arquivos e tente novamente.')
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
          {files.length > analysisLimit && <span>As primeiras {analysisLimit} mídias serão analisadas.</span>}
          {ready && !analysisError && !successMessage && <span className="media-ai-generator-ready">Pronto para analisar sua mídia.</span>}
          {analysisError && <span className="media-ai-generator-error" role="alert">{analysisError}</span>}
          {successMessage && <span className="media-ai-generator-success" role="status">✓ {successMessage}</span>}
          {analysisNotes.length > 0 && <span className="media-ai-generator-notes">{analysisNotes.slice(0, 2).join(' · ')}</span>}
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

function previewAspectOptions(platform, instagramFormat, mediaKind) {
  if (platform === 'instagram' && ['reel', 'story'].includes(instagramFormat)) return [PREVIEW_ASPECTS.vertical]
  if (platform === 'instagram') return [PREVIEW_ASPECTS.square, PREVIEW_ASPECTS.portrait, PREVIEW_ASPECTS.instagramWide]
  if (platform === 'tiktok' && mediaKind === 'video') return [PREVIEW_ASPECTS.vertical]
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
  return <div className={`social-preview-media social-preview-media-${platform} ${aspectClass} ${mediaClass}`} style={{ '--preview-aspect': String(aspect.ratio) }} data-media-kind={isVideo ? 'video' : 'image'} data-preview-aspect={aspect.label}>{media}{platform === 'instagram' && previews.length > 1 && <div className="social-preview-carousel-dots" aria-label={`${previews.length} fotos em carrossel`}>{previews.slice(0, 5).map((preview, index) => <span className={index === 0 ? 'is-active' : ''} key={preview.key}/>)}<small>{previews.length} fotos</small></div>}{platform === 'tiktok' && <div className="social-preview-tiktok-overlay"><strong>{accountHandle}</strong><span>♡ 0</span><span>💬 0</span><span>↗</span></div>}</div>
}

function PostPreview({ textByPlatform, titleByPlatform, selected, files, previews, publishNow, date, youtubeTitle, igFormat, igAspect, tiktokAspect, youtubeFormat, mediaProfile, accounts }) {
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
  const requestedAspect = activePlatform === 'instagram' ? igAspect : activePlatform === 'tiktok' ? tiktokAspect : activePlatform === 'youtube' && youtubeFormat === 'short' ? 'vertical' : 'auto'
  const resolvedAspect = resolvePreviewAspect({ platform: activePlatform, mediaKind: mediaProfile?.kind, sourceRatio: mediaProfile?.ratio, requested: requestedAspect, instagramFormat: igFormat })
  const mediaLabel = mediaProfile ? `${mediaProfile.kind === 'video' ? 'Vídeo' : 'Foto'} · ${resolvedAspect.label}` : resolvedAspect.label
  const formatLabel = activePlatform === 'instagram' ? `${['reel', 'story'].includes(igFormat) ? (igFormat === 'reel' ? 'Reel' : 'Story') : 'Feed'} · ${mediaLabel}` : activePlatform === 'youtube' ? `${youtubeFormat === 'short' ? 'Short' : 'Vídeo'} · ${mediaLabel}` : activePlatform === 'tiktok' && mediaProfile?.kind === 'video' ? `Vídeo para TikTok · ${TIKTOK_VIDEO_DIMENSIONS.label}` : activePlatform === 'tiktok' ? `TikTok · ${mediaLabel}` : `Feed · ${mediaLabel}`
  const resolutionHint = socialMediaResolutionHint(activePlatform, { instagramFormat: igFormat, youtubeFormat, mediaKind: mediaProfile?.kind })
  return <aside className="post-preview" aria-label="Pré-visualização da publicação">
    <div className="post-preview-heading"><div><p className="eyebrow">PREVIEW REALISTA</p><h3>Veja em cada rede</h3></div><span className="post-preview-status">{publishNow ? 'Agora' : date ? 'Agendada' : 'Rascunho'}</span></div>
    <div className="preview-network-tabs" role="tablist" aria-label="Prévia por rede social">{availablePlatforms.map(platform => <button type="button" role="tab" aria-selected={activePlatform === platform} className={`preview-network-tab preview-network-tab-${platform}${activePlatform === platform ? ' is-active' : ''}`} key={platform} onClick={() => setActivePlatform(platform)}><span className="preview-network-tab-icon"><PlatformIcon platform={platform} className="h-4 w-4"/></span>{previewLabels[platform]}</button>)}</div>
     <div className="social-preview-format"><span>Formato simulado</span><strong>{formatLabel}</strong><small>Resolução recomendada: {resolutionHint}</small></div><div className="social-preview-detection" role="status"><span className={mediaProfile?.kind === 'video' ? 'is-video' : 'is-image'}>{mediaProfile ? mediaKindLabel(mediaProfile.kind) : 'Aguardando mídia'}</span><small>{mediaProfile?.ratio ? `Original ${ratioLabel(mediaProfile.width, mediaProfile.height)}` : 'A proporção será detectada ao adicionar a mídia.'}</small></div><div className={`social-preview-card social-preview-card-${activePlatform}`}>
      <div className="social-preview-account"><span className={`social-preview-avatar social-preview-avatar-${activePlatform}`}>{connectedAccount?.avatarUrl ? <img src={connectedAccount.avatarUrl} alt=""/> : <PlatformIcon platform={activePlatform} className="h-4 w-4"/>}</span><div><strong>{accountLabel}</strong><small>{previewLabels[activePlatform]} · agora</small></div><span className="social-preview-more" aria-hidden="true">•••</span></div>
      {isYoutube ? <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-youtube-copy"><strong>{youtubeTitle || activeText || 'Título do seu vídeo aparecerá aqui'}</strong><small>{accountLabel} · 0 visualizações · agora</small></div></> : isTiktok ? <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-tiktok-copy"><strong>{activeTitle || 'Adicione um título para o TikTok'}</strong><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'A descrição da sua publicação aparecerá aqui.'}</p></div></> : isFacebook ? <><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'O texto da sua publicação aparecerá aqui.'}</p><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-actions"><span>♡</span><span>◯</span><span>↗</span><small>{files.length ? `${files.length} mídia${files.length > 1 ? 's' : ''}` : 'Sem mídia'}</small></div></> : <><PreviewMedia platform={activePlatform} previews={previews} igFormat={igFormat} aspectRequest={requestedAspect} mediaProfile={mediaProfile} accountHandle={accountHandle}/><div className="social-preview-actions"><span>♡</span><span>◯</span><span>↗</span><small>{files.length ? `${files.length} mídia${files.length > 1 ? 's' : ''}` : 'Sem mídia'}</small></div><p className={`social-preview-caption${activeText ? '' : ' is-placeholder'}`}>{activeText || 'O texto da sua publicação aparecerá aqui.'}</p></>}
    </div>
    <p className="post-preview-hint">A prévia simula a estrutura visual da rede. O resultado final pode variar conforme o formato e a conta.</p>
  </aside>
}

function SchedulerErrorCard({ message, resultSummary, onReview, onClose }) {
  return <div className="scheduler-feedback-card scheduler-error-card" role="alert">
    <div className="scheduler-feedback-icon" aria-hidden="true">!</div>
    <div className="scheduler-feedback-copy">
      <p className="scheduler-feedback-kicker">PRECISA DE ATENÇÃO</p>
      <h3>Não foi possível concluir a publicação</h3>
      <p>{message || 'Revise os dados do post antes de tentar novamente.'}</p>
      {resultSummary && <div className="scheduler-result-summary">
        {resultSummary.published.length > 0 && <div className="scheduler-result-group is-published"><strong>Publicadas</strong>{resultSummary.published.map(label => <span key={label}>✓ {label}</span>)}</div>}
        {resultSummary.failures.length > 0 && <div className="scheduler-result-group is-failed"><strong>Não publicadas</strong>{resultSummary.failures.map(item => <span key={`${item.label}-${item.error}`}><b>{item.label}</b><small>{item.error}</small></span>)}</div>}
      </div>}
      <div className="scheduler-feedback-actions"><button type="button" className="scheduler-feedback-primary" onClick={onReview}>Revisar no editor</button><button type="button" className="scheduler-feedback-secondary" onClick={onClose}>Fechar aviso</button></div>
    </div>
    <button type="button" className="scheduler-feedback-close" onClick={onClose} aria-label="Fechar erro">×</button>
  </div>
}

export function SchedulerPage() {
  const [textByPlatform, setTextByPlatform] = useState({})
  const [titleByPlatform, setTitleByPlatform] = useState({})
  const [date, setDate] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [selected, setSelected] = useState(['instagram'])
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [selectedAccountIds, setSelectedAccountIds] = useState([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
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
  const [savedMessage, setSavedMessage] = useState(null)
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
  const sourceFailureId = useRef(null)
  const accountGroups = useMemo(() => groupAccountsByPerson(connectedAccounts), [connectedAccounts])

  useEffect(() => {
    if (['reel', 'story'].includes(igFormat) && igAspect !== 'auto') setIgAspect('auto')
    if (igFormat === 'post' && !['auto', 'square', 'portrait', 'instagramWide'].includes(igAspect)) setIgAspect('auto')
  }, [igFormat, igAspect])
  const serverDraftId = useRef(null)
  const validationWorker = useMemo(() => createPostValidationWorker(({ requestId, issues }) => {
    if (requestId === validationRequest.current) setWorkerIssues(issues)
  }), [])

  function clearComposer() {
    setTextByPlatform({}); setTitleByPlatform({}); setDate(''); setFiles([]); setYoutubeTitle(''); setYoutubeMadeForKids(''); setYoutubeCategoryId(''); setYoutubeFormat(''); setTiktokDisableComment(false); setTiktokDisableDuet(false); setTiktokDisableStitch(false); setPublishNow(false); setSavedMessage(null); localStorage.removeItem(AUTOSAVE_KEY); setDraftSavedAt(null); setServerDraftStatus('')
  }

  function reviewError() {
    setError('')
    setPublicationStatus(null)
    window.requestAnimationFrame(() => {
      const editor = document.querySelector('.sched-form')
      editor?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      editor?.querySelector('textarea, input, select')?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    apiFetch('/api/accounts').then(data => {
      const accounts = data.data || []
      setConnectedAccounts(accounts)
      setSelectedAccountIds(accounts.map(account => account.id))
      setAccountsLoaded(true)
    }).catch(() => {
      setConnectedAccounts([])
      setSelectedAccountIds([])
      setAccountsLoaded(true)
    })
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
        sourceFailureId.current = savedDraft.sourceFailureId || null
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
        setYoutubeFormat(savedDraft.youtubeFormat || '')
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
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ textByPlatform, titleByPlatform, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, youtubeFormat, igFormat, igAspect, tiktokAspect, tiktokPrivacyLevel, sourceFailureId: sourceFailureId.current, savedAt: savedAt.toISOString() }))
      setDraftSavedAt(savedAt)
    }, 700)
    return () => clearTimeout(timer)
  }, [draftReady, textByPlatform, titleByPlatform, date, publishNow, selected, youtubeTitle, youtubeVisibility, youtubeMadeForKids, youtubeFormat, igFormat, igAspect, tiktokAspect, tiktokPrivacyLevel, files.length])

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
          if (result.type === 'success') clearComposer()
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

  function toggle(platform) {
    setSelected(value => value.includes(platform) ? value.filter(item => item !== platform) : [...value, platform])
    if (platform === 'tiktok' && !selected.includes(platform) && files.some(file => !file.type.startsWith('video/'))) {
      setError('O TikTok aceita somente um vídeo por publicação. Remova as imagens antes de selecionar o TikTok.')
    }
  }
  function toggleAccount(accountId) {
    const key = accountIdKey(accountId)
    setSelectedAccountIds(current => current.some(id => accountIdKey(id) === key)
      ? current.filter(id => accountIdKey(id) !== key)
      : [...current, accountId])
  }
  function selectAllPersonAccounts(personKey, shouldSelect) {
    const group = accountGroups.find(item => item.key === personKey)
    if (!group) return
    const availableIds = group.accounts.filter(account => selected.includes(account.platform)).map(account => account.id)
    setSelectedAccountIds(current => {
      const currentKeys = new Set(current.map(accountIdKey))
      if (shouldSelect) return [...current, ...availableIds.filter(id => !currentKeys.has(accountIdKey(id)))]
      const groupKeys = new Set(availableIds.map(accountIdKey))
      return current.filter(id => !groupKeys.has(accountIdKey(id)))
    })
  }
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
    const incoming = Array.from(fileList || []).map(normalizeMediaFile)
    const valid = incoming.filter(file => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return false
      return !selected.includes('tiktok') || file.type.startsWith('video/')
    })
    if (incoming.length !== valid.length) {
      setError(selected.includes('tiktok')
        ? 'O TikTok aceita somente arquivos de vídeo. As imagens foram ignoradas.'
        : 'Alguns arquivos foram ignorados. Selecione somente imagens ou vídeos.')
    }
    setFiles(current => {
      const merged = [...current, ...valid]
      const unique = merged.filter((file, index, list) => list.findIndex(item => mediaFileKey(item) === mediaFileKey(file)) === index)
      if (selected.includes('tiktok') && unique.length > 1) {
        setError('O TikTok aceita somente um vídeo por publicação. Remova os arquivos extras.')
        return current
      }
      const carouselLimit = INSTAGRAM_CAROUSEL_MAX_ITEMS
      if (!selected.includes('tiktok') && unique.length > carouselLimit) {
        setError(`Este carrossel pode ter no máximo ${carouselLimit} fotos para as redes selecionadas.`)
        return current
      }
      if (unique.length > 1 && unique.some(file => file.type.startsWith('video/'))) {
        setError('Carrosséis usam somente fotos. Remova o vídeo antes de adicionar outras imagens.')
        return current
      }
      if (unique.length > 1 && selected.includes('instagram') && igFormat !== 'post') setIgFormat('post')
      return unique
    })
  }
  function selectFiles(event) { addFiles(event.target.files); event.target.value = '' }
  function dropFiles(event) { event.preventDefault(); addFiles(event.dataTransfer.files) }
  function removeFile(key) { setFiles(current => current.filter(file => mediaFileKey(file) !== key)) }
  function moveFile(index, direction) {
    setFiles(current => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }
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

  const carouselQualityNotes = useMemo(() => {
    if (files.length < 2 || files.some(file => !file.type.startsWith('image/'))) return []
    const metas = files.map(file => mediaMetaByKey[mediaFileKey(file)]).filter(Boolean)
    if (metas.length !== files.length) return ['Estamos lendo as dimensões de todas as fotos antes de recomendar ajustes.']
    const ratios = metas.map(meta => meta.width / meta.height).filter(Number.isFinite)
    const notes = []
    if (selected.includes('instagram') && ratios.some(ratio => ratio < 0.8 || ratio > 1.91)) {
      notes.push('Uma ou mais fotos estão fora da faixa segura do Feed do Instagram (4:5 a 1,91:1).')
    }
    if (ratios.length > 1 && Math.max(...ratios) - Math.min(...ratios) > 0.18) {
      notes.push('As fotos têm proporções diferentes; padronizar o enquadramento deixa o carrossel mais uniforme.')
    }
    if (metas.some(meta => Math.min(meta.width, meta.height) < 600)) {
      notes.push('Uma ou mais fotos têm baixa resolução e podem perder nitidez após o processamento da rede.')
    }
    return notes
  }, [files, mediaMetaByKey, selected])

  const validationInput = {
    textByPlatform, titleByPlatform, tiktokDescription: textByPlatform.tiktokDescription || '', platforms: selected, files: files.map(({ name, lastModified, size, type }) => ({ name, lastModified, size, type })),
    publishNow, scheduledAt: date, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey, mediaMetaByKey
  }
  useEffect(() => {
    const requestId = ++validationRequest.current
    if (!validationWorker) {
      setWorkerIssues(buildValidationIssues(validationInput))
      return
    }
    validationWorker.postMessage({ ...validationInput, requestId })
  }, [validationWorker, textByPlatform, titleByPlatform, selected, files, publishNow, date, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey, mediaMetaByKey])
  const issues = workerIssues
  const accountSelectionIssues = accountsLoaded ? buildAccountSelectionIssues(connectedAccounts, selected, selectedAccountIds) : []
  const blockingIssues = [...issues, ...accountSelectionIssues]

  async function uploadFile(file) {
    const data = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
    const response = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!response.ok) throw new Error(`Falha ao enviar ${file.name}`)
    const uploaded = await response.json().catch(() => null)
    // Em modo privado o backend fornece uma URL proxy assinada; no modo
    // público preservamos a URL final devolvida pelo Blob.
    const mediaUrl = data.mediaUrl || uploaded?.url
    if (!mediaUrl) throw new Error(`O upload de ${file.name} não retornou uma URL válida.`)
    return { url: mediaUrl, mimetype: file.type, name: file.name }
  }

  async function submit(event) {
    event.preventDefault(); setError(''); setSavedMessage(null); setPublicationStatus(null); setProgress('')
    if (blockingIssues.length > 0) { setError(blockingIssues[0].message); return }
    setLoading(true)
    try {
      const eventCursor = publishNow ? await latestPublicationEventId(apiFetch) : 0
      setProgress(files.length ? 'Enviando mídias...' : 'Validando agendamento...')
      const media = await uploadWithConcurrency(files, uploadFile, 3, (completed, total) => setProgress(`Enviando mídias (${completed}/${total})...`))
      const scheduledAt = publishNow ? new Date().toISOString() : date
      const platformTexts = Object.fromEntries(Object.entries(textByPlatform).filter(([platform]) => selected.includes(platform)))
      const accountIds = selectedAccountsForPost(connectedAccounts, selected, selectedAccountIds)
      setProgress(publishNow ? 'Preparando publicação imediata...' : 'Processando e salvando agendamento...')
      const createdPost = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ textByPlatform: JSON.stringify(platformTexts), titleByPlatform: JSON.stringify(titleByPlatform), scheduledAt, platforms: JSON.stringify(selected), accountIds: JSON.stringify(accountIds), publishNow, media: JSON.stringify(media), youtubeTitle, youtubeVisibility, youtubeMadeForKids: youtubeMadeForKids === '' ? undefined : youtubeMadeForKids === 'true', youtubeCategoryId: youtubeCategoryId || undefined, youtubeFormat: youtubeFormat || undefined, igFormat, tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch }) })
      if (sourceFailureId.current) {
        const replacedFailureId = sourceFailureId.current
        sourceFailureId.current = null
        apiFetch(`/api/posts/${replacedFailureId}`, { method: 'DELETE' }).catch(() => {})
      }
      if (serverDraftId.current) { apiFetch(`/api/drafts/${serverDraftId.current}`, { method: 'DELETE' }).catch(() => {}); serverDraftId.current = null }
      const successMessage = publishNow ? null : scheduledPublicationDetails(date, selected)
      if (!publishNow) { clearComposer(); setSavedMessage(successMessage) }
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
  const carouselPlatforms = selected.includes('instagram') && !selected.includes('tiktok') ? ['instagram'] : []
  const carouselLimit = INSTAGRAM_CAROUSEL_MAX_ITEMS
  const isPhotoCarousel = files.length > 1 && files.every(file => file.type.startsWith('image/'))

  return <section className="page-view scheduler-page"><section className="panel scheduler-panel"><header className="scheduler-heading"><div><p className="eyebrow">PUBLICAÇÃO</p><h2>{publishNow ? 'Publicar agora' : 'Agendar publicação'}</h2><p>Prepare uma publicação e distribua para as redes selecionadas.</p></div>{(draftSavedAt || serverDraftStatus) && <span className="autosave-status" role="status">{serverDraftStatus || `Salvo localmente às ${draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span>}</header><div className="scheduler-workspace"><form className="draft-form sched-form" onSubmit={submit}>

    <SchedSection number={1} title="Plataformas">
      <div className="platform-options">{platforms.map(platform => {
        const platformAccounts = accountsForPlatform(connectedAccounts, platform)
        const selectedCount = platformAccounts.filter(account => selectedAccountIds.some(id => accountIdKey(id) === accountIdKey(account))).length
        const connectedAccount = platformAccounts.find(account => selectedAccountIds.some(id => accountIdKey(id) === accountIdKey(account))) || platformAccounts[0]
        const accountLabel = connectedAccount?.handle || connectedAccount?.name
        const isSelected = selected.includes(platform)
        return <div className={`platform-selection platform-selection-${platform}`} key={platform}><label className={`platform-option platform-option-${platform}`}>
          <input type="checkbox" checked={isSelected} onChange={() => toggle(platform)} aria-label={`${isSelected ? 'Desmarcar' : 'Selecionar'} ${platform}`}/>
          <span className="platform-option-icon" aria-hidden="true"><PlatformIcon platform={platform} className="h-6 w-6"/></span>
          <span className="platform-option-name">{platform[0].toUpperCase() + platform.slice(1)}</span>
          <span className="platform-option-hint">{isSelected ? 'Selecionada' : 'Selecionar'}</span>
          <span className="platform-option-account">{selectedCount > 1 ? `${selectedCount} contas selecionadas` : accountLabel ? (accountLabel.startsWith('@') ? accountLabel : `@${accountLabel}`) : 'Nenhuma conta conectada'}</span>
          <span className="platform-option-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
        </label></div>
      })}</div>
      <div className="person-account-groups" aria-label="Contas organizadas por pessoa">
        <div className="person-account-groups-heading"><div><strong>Contas por pessoa</strong><small>Cada pessoa reúne todas as suas redes. O post será enviado somente às contas marcadas.</small></div><span>{connectedAccounts.length} conta{connectedAccounts.length === 1 ? '' : 's'}</span></div>
        {accountGroups.length ? <div className="person-account-groups-list">{accountGroups.map(group => {
          const selectedGroupAccounts = group.accounts.filter(account => selectedAccountIds.some(id => accountIdKey(id) === accountIdKey(account)))
          const groupPlatforms = Array.from(new Set(group.accounts.map(account => platformLabels[account.platform] || account.platform)))
          return <article className="person-account-group" key={group.key}>
            <header className="person-account-group-heading"><div><strong>{group.label}</strong><small>{group.accounts.length} conta{group.accounts.length === 1 ? '' : 's'} · {groupPlatforms.join(' · ')}</small></div><div className="person-account-group-actions"><span>{selectedGroupAccounts.length} selecionada{selectedGroupAccounts.length === 1 ? '' : 's'}</span><button type="button" onClick={() => selectAllPersonAccounts(group.key, true)}>Todas</button><button type="button" onClick={() => selectAllPersonAccounts(group.key, false)}>Nenhuma</button></div></header>
            <div className="person-account-group-list">{group.accounts.map(account => {
              const accountSelected = selectedAccountIds.some(id => accountIdKey(id) === accountIdKey(account))
              const networkSelected = selected.includes(account.platform)
              const label = account.handle || account.name || account.tokens?.find(token => token.accountName)?.accountName || `Conta ${account.id}`
              const tokenStatus = account.tokens?.find(token => token.status)?.status || 'unknown'
              return <label className={`person-account-row${accountSelected ? ' is-selected' : ''}${!networkSelected ? ' is-disabled' : ''}`} key={account.id}>
                <input type="checkbox" checked={accountSelected} disabled={!networkSelected} onChange={() => toggleAccount(account.id)} aria-label={`Usar ${label} no ${platformLabels[account.platform] || account.platform}`}/>
                {account.avatarUrl ? <img src={account.avatarUrl} alt="" aria-hidden="true"/> : <span className={`person-account-platform person-account-platform-${account.platform}`} aria-hidden="true"><PlatformIcon platform={account.platform} className="h-4 w-4"/></span>}
                <span className="person-account-row-copy"><strong>{label}</strong><small>{platformLabels[account.platform] || account.platform}{account.name && account.handle ? ` · ${account.name}` : ''}{account.ownerEmail ? ` · ${account.ownerEmail}` : ''}</small></span>
                <span className={`person-account-token person-account-token-${tokenStatus}`}>{tokenStatus === 'valid' ? 'Token válido' : tokenStatus === 'expiring' ? 'Expirando' : tokenStatus === 'expired' || tokenStatus === 'error' ? 'Requer atenção' : 'Sem status'}</span>
                {!networkSelected && <small className="person-account-disabled-note">Selecione a rede</small>}
              </label>
            })}</div>
          </article>
        })}</div> : <p className="platform-account-empty">Nenhuma conta conectada. Conecte uma conta antes de continuar.</p>}
      </div>
    </SchedSection>

    <SchedSection number={2} title="Mídia e conteúdo">
      <div className="upload-field" onDragOver={event => event.preventDefault()} onDrop={dropFiles}>
      <div className="upload-field-heading"><div><p className="eyebrow">{isPhotoCarousel ? 'CARROSSEL' : mediaProfile?.kind === 'video' ? 'VÍDEO' : mediaProfile?.kind === 'image' ? 'FOTO' : 'MÍDIAS'}</p><strong>{isPhotoCarousel ? `${files.length} fotos em sequência` : mediaProfile?.kind === 'video' ? 'Vídeo detectado' : mediaProfile?.kind === 'image' ? 'Foto detectada' : 'Escolha os arquivos da publicação'}</strong></div><span aria-hidden="true">▧</span></div>
      <label className="upload-picker"><span className="upload-picker-icon" aria-hidden="true">↑</span><span className="upload-picker-copy"><strong>{carouselPlatforms.length ? 'Adicionar fotos ao carrossel' : 'Escolher arquivo'}</strong><small>{carouselPlatforms.length ? `Feed do Instagram · até ${carouselLimit} fotos` : selected.includes('tiktok') ? 'Somente vídeo · MP4, MOV ou WebM' : 'Imagem ou vídeo · HEIC/HEIF também aceito'}</small></span><input className="upload-picker-input" type="file" multiple={carouselPlatforms.length > 0} accept={selected.includes('tiktok') ? 'video/*' : 'image/*,image/heic,image/heif,video/*'} onChange={selectFiles} aria-label={selected.includes('tiktok') ? 'Selecionar um vídeo para o TikTok' : 'Selecionar imagens ou vídeos'}/></label>
        <p className="upload-drop-hint">ou arraste os arquivos até aqui · a ordem das fotos será mantida na publicação</p>
      </div>
      {files.length > 0 && <div className={`media-preview-grid${selected.includes('tiktok') ? ' media-preview-grid-tiktok' : ''}`} aria-label="Arquivos selecionados">{mediaPreviews.map((item, index) => <article className="media-preview-card" key={item.key}>
        {isPhotoCarousel && index === 0 && <span className="media-cover-badge">Capa</span>}
        {item.file.type.startsWith('image/') ? <img src={item.url} alt={`Prévia de ${item.file.name}`} /> : <video className="media-video-thumb" src={item.url} muted playsInline preload="metadata" aria-label={`Prévia do vídeo ${item.file.name}`} />}
        <div className="media-preview-info"><strong title={item.file.name}>{isPhotoCarousel ? `${index + 1}. ${item.file.name}` : item.file.name}</strong><small>{item.file.type.startsWith('video/') ? 'Vídeo' : 'Foto'} · {formatFileSize(item.file.size)}</small></div>
        {isPhotoCarousel && <div className="media-order-actions"><button type="button" onClick={() => moveFile(index, -1)} disabled={index === 0} aria-label={`Mover ${item.file.name} para a esquerda`}>←</button><button type="button" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1} aria-label={`Mover ${item.file.name} para a direita`}>→</button></div>}
        <button type="button" className="media-remove-button" onClick={() => removeFile(item.key)} aria-label={`Remover ${item.file.name}`}>×</button>
      </article>)}{carouselPlatforms.length > 0 && <label className="media-add-card"><span aria-hidden="true">＋</span><small>Adicionar fotos</small><input className="upload-picker-input" type="file" multiple accept="image/*" onChange={selectFiles} aria-label="Adicionar fotos ao carrossel"/></label>}</div>}
      {mediaProfile && <div className="media-detection-panel" role="status"><div><strong>{mediaKindLabel(mediaProfile.kind)}</strong><span>{mediaProfile.ratio ? `Original ${ratioLabel(mediaProfile.width, mediaProfile.height)}` : 'Lendo a proporção original…'}</span></div><small>{mediaProfile.width && mediaProfile.height ? `${mediaProfile.width} × ${mediaProfile.height}px` : 'A prévia será ajustada automaticamente.'}</small>{selected.includes('tiktok') && mediaProfile.kind === 'video' && <small>Versão enviada ao TikTok: {TIKTOK_VIDEO_DIMENSIONS.label} · vertical 9:16</small>}</div>}
      {isPhotoCarousel && carouselQualityNotes.length > 0 && <div className="carousel-quality-panel" role="status"><strong>Revisão visual do carrossel</strong>{carouselQualityNotes.map(note => <span key={note}>• {note}</span>)}</div>}
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
             {platform === 'instagram' && <div className="platform-composer-settings-grid"><label>Formato Instagram<select value={igFormat} onChange={event => setIgFormat(event.target.value)}><option value="post">Feed</option><option value="reel">Reel</option><option value="story">Story</option></select></label><label>Proporção da prévia Instagram<select value={igAspect} onChange={event => setIgAspect(event.target.value)}>{igFormat === 'post' && <><option value="auto">Automático · detectar</option><option value="square">Foto · 1:1 · 1080 × 1080</option><option value="portrait">Foto · 4:5 · 1080 × 1350</option><option value="instagramWide">Foto · 1,91:1 · 1080 × 566</option></>}{['reel', 'story'].includes(igFormat) && <option value="vertical">Vídeo vertical · 9:16 · 1080 × 1920</option>}</select></label></div>}
             {platform === 'facebook' && <p className="platform-composer-no-settings">Formatos recomendados para o feed: {SOCIAL_MEDIA_RESOLUTIONS.facebook.feed.map(item => item.dimensions).join(' · ')}. A publicação continua aceitando imagem ou vídeo.</p>}
             {platform === 'youtube' && <div className="platform-composer-settings-grid"><label>Título do YouTube<input value={youtubeTitle} onChange={event => setYoutubeTitle(event.target.value)} maxLength={100}/></label><label>Visibilidade<select value={youtubeVisibility} onChange={event => setYoutubeVisibility(event.target.value)}><option value="public">Público</option><option value="unlisted">Não listado</option><option value="private">Privado</option></select></label><label>Feito para crianças (YouTube)<select value={youtubeMadeForKids} onChange={event => setYoutubeMadeForKids(event.target.value)}><option value="">Selecione...</option><option value="false">Não</option><option value="true">Sim</option></select></label><label>Categoria do YouTube<select value={youtubeCategoryId} onChange={event => setYoutubeCategoryId(event.target.value)}><option value="">Automática</option>{youtubeCategories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label><label>Formato do YouTube<select value={youtubeFormat} onChange={event => setYoutubeFormat(event.target.value)}><option value="">Automático · 1920 × 1080</option><option value="video">Vídeo · 1920 × 1080</option><option value="short">Short · 1080 × 1920</option></select></label></div>}
      {platform === 'tiktok' && <div className="platform-composer-settings-grid"><label>Formato do vídeo TikTok<span className="platform-composer-fixed-format">{TIKTOK_VIDEO_DIMENSIONS.label} · vídeo entre 9:16 e 16:9</span></label><label>Privacidade TikTok<select value={tiktokPrivacyLevel} onChange={event => setTiktokPrivacyLevel(event.target.value)}><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="SELF_ONLY">Somente eu</option></select></label><fieldset className="checkbox-group"><legend>Interações do TikTok</legend><div className="checkbox-row"><label><input type="checkbox" checked={tiktokDisableComment} onChange={event => setTiktokDisableComment(event.target.checked)}/> Bloquear comentários</label><label><input type="checkbox" checked={tiktokDisableDuet} onChange={event => setTiktokDisableDuet(event.target.checked)}/> Bloquear duet</label><label><input type="checkbox" checked={tiktokDisableStitch} onChange={event => setTiktokDisableStitch(event.target.checked)}/> Bloquear stitch</label></div></fieldset></div>}
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

      {blockingIssues.length > 0 && <div className="validation-panel" aria-live="polite"><p className="validation-panel-heading">⚠ {blockingIssues.length} {blockingIssues.length === 1 ? 'pendência' : 'pendências'} antes de {publishNow ? 'publicar' : 'agendar'}</p><ul className="validation-panel-list">{blockingIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div>}
    <div className="scheduler-submit-actions"><button className="action-button" disabled={loading || blockingIssues.length > 0}>{loading ? progress || 'Processando...' : publishNow ? 'Publicar agora' : 'Agendar'}</button><button type="button" className="secondary-button" onClick={saveAsTemplate} disabled={loading || !Object.values(textByPlatform).some(value => value?.trim())}>Salvar como modelo</button></div>
  </form><PostPreview textByPlatform={textByPlatform} titleByPlatform={titleByPlatform} selected={selected} files={files} previews={mediaPreviews} publishNow={publishNow} date={date} youtubeTitle={youtubeTitle} igFormat={igFormat} igAspect={igAspect} tiktokAspect={tiktokAspect} youtubeFormat={youtubeFormat} mediaProfile={mediaProfile} accounts={connectedAccounts}/></div>{savedMessage && !publicationStatus && <div className="scheduler-success-card" role="status"><div className="scheduler-success-icon" aria-hidden="true">✓</div><div className="scheduler-success-copy"><p className="scheduler-success-kicker">TUDO CERTO!</p><h3>Seu post está na agenda</h3><p>Ele será publicado em <strong>{savedMessage.date}</strong>.</p><div className="scheduler-success-platforms"><span>Redes selecionadas</span>{savedMessage.platformList.map(platform => <span key={platform} className="scheduler-success-platform">✓ {platform}</span>)}</div><p className="scheduler-success-hint">Você pode acompanhar ou editar esse agendamento no calendário.</p></div><button type="button" className="scheduler-success-close" onClick={() => setSavedMessage(null)} aria-label="Fechar confirmação">×</button></div>}{publicationStatus?.type === 'error' && <SchedulerErrorCard message={publicationStatus.message} resultSummary={publicationStatus.resultSummary} onReview={reviewError} onClose={() => setPublicationStatus(null)} />}{publicationStatus && publicationStatus.type === 'warning' && <SchedulerErrorCard message={publicationStatus.message} resultSummary={publicationStatus.resultSummary} onReview={reviewError} onClose={() => setPublicationStatus(null)} />}{publicationStatus && publicationStatus.type === 'success' && <p className="success-message" role="status">{publicationStatus.message}</p>}{error && <SchedulerErrorCard message={error} onReview={reviewError} onClose={() => setError('')} />}</section></section>
}
