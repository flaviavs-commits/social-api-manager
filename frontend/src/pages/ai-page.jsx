import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { PublicationStatusModal } from '../components/ui/publication-status-modal.jsx'
import { useToast } from '../components/ui/toast.jsx'
import { findPublicationResult, latestPublicationEventId, processingPublicationMessage, publicationResultMessage } from '../lib/publicationEvents.js'
import '../styles/ai-page-publish.css'

// O backend espera até 45s pelo provedor. O OpenRouter pode precisar de alguns
// segundos adicionais para devolver a resposta ou o fallback do servidor.
const AI_GENERATION_TIMEOUT_MS = 60_000
const AI_ACTIVITY_LABELS = {
  generate: 'Conteúdo gerado com IA',
  'analyze-media': 'Descrição de mídia gerada',
  'image-generate': 'Imagem gerada com IA',
  'chat-message': 'Conversa com a IA',
  schedule: 'Agendamento processado',
  'publish-now': 'Publicação processada',
}
const PUBLISH_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', symbol: '◎', hint: 'Imagem obrigatória' },
  { id: 'facebook', label: 'Facebook', symbol: 'f', hint: 'Imagem opcional' },
  { id: 'tiktok', label: 'TikTok', symbol: '♪', hint: 'Imagem ou vídeo' },
  { id: 'youtube', label: 'YouTube', symbol: '▶', hint: 'Exige vídeo', videoOnly: true },
]

function formatAiActivity(log) {
  const action = String(log.acao || '')
  const title = AI_ACTIVITY_LABELS[action] || (action.startsWith('agent:') || action === 'agent' ? 'Assistente IA' : 'Atividade de IA')
  const details = String(log.detalhes || '')
    .split(' · ')
    .filter(part => !/^(fallback|tentados|chave do servidor|chave do usuário)\b/i.test(part.trim()))
    .join(' · ')
    .replace(/\bopenrouter(?:[-_][\w-]+)?\b/gi, 'IA')
    .trim()

  return { title, details: details || 'Processamento concluído' }
}

export function AiPage() {
  const [instruction, setInstruction] = useState('')
  const [visualFormat, setVisualFormat] = useState('single')
  const [carouselCount, setCarouselCount] = useState(5)
  const [posts, setPosts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [activityLogs, setActivityLogs] = useState([])
  const [analyticsInsights, setAnalyticsInsights] = useState(null)
  const [analyticsDays, setAnalyticsDays] = useState(30)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const [imageLoadingIndex, setImageLoadingIndex] = useState(null)
  const [imageLoadingProgress, setImageLoadingProgress] = useState(null)
  const [publishingIndex, setPublishingIndex] = useState(null)
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountsLoadError, setAccountsLoadError] = useState(false)
  const [publishModalIndex, setPublishModalIndex] = useState(null)
  const [publishPlatform, setPublishPlatform] = useState('instagram')
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('PUBLIC_TO_EVERYONE')
  const [publicationDialog, setPublicationDialog] = useState(null)
  const [publicationProgress, setPublicationProgress] = useState('')
  const publicationPollTimer = useRef(null)
  const notify = useToast()

  useEffect(() => {
    apiFetch('/api/ai/activity-log?limit=20')
      .then(data => setActivityLogs(data.logs || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/accounts?ativo=true')
      .then(data => setConnectedAccounts(Array.isArray(data.data) ? data.data : []))
      .catch(() => setAccountsLoadError(true))
      .finally(() => setAccountsLoaded(true))
  }, [])

  useEffect(() => () => clearTimeout(publicationPollTimer.current), [])

  async function generate(event) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const data = await apiFetch('/api/ai/generate', { method: 'POST', timeoutMs: AI_GENERATION_TIMEOUT_MS, body: JSON.stringify({ instrucao: instruction, plataformas: ['instagram'], quantidade: 3, tom: 'profissional' }) })
      const requestedFormat = requestedVisualFormat()
      setPosts((data.posts || []).map(post => normalizePost(post, requestedFormat)))
      setEditingIndex(null)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  // Gera mais ideias sobre o mesmo assunto (mesma instrução e modelo já
  // usados) e acrescenta às sugestões já na tela, em vez de substituí-las —
  // permite ao usuário pedir várias rodadas de ideias sem perder as
  // anteriores nem reescrever a instrução.
  async function generateMore() {
    setLoadingMore(true); setError('')
    try {
      const data = await apiFetch('/api/ai/generate', { method: 'POST', timeoutMs: AI_GENERATION_TIMEOUT_MS, body: JSON.stringify({ instrucao: instruction, plataformas: ['instagram'], quantidade: 3, tom: 'profissional' }) })
      const novos = (data.posts || []).map(post => normalizePost(post, requestedVisualFormat()))
      setPosts(current => [...current, ...novos])
    } catch (e) { setError(e.message) } finally { setLoadingMore(false) }
  }

  function requestedVisualFormat() {
    const instructionRequestsCarousel = /\b(carrossel|carousel|slides?|sequência de imagens)\b/i.test(instruction)
    return visualFormat === 'carousel' || instructionRequestsCarousel ? 'carousel' : 'single'
  }

  function normalizePost(post, format = visualFormat) {
    return {
      ...post,
      // A resposta antiga da API podia não trazer a lista de redes. Mantenha
      // sempre um valor seguro para a publicação gerada pela IA.
      plataformas: Array.isArray(post.plataformas) && post.plataformas.length ? post.plataformas : ['instagram'],
      text: post.texto || post.text || post.caption || '',
      visualFormat: format,
      carouselCount: format === 'carousel' ? carouselCount : 5,
      imageUrl: null,
      carouselImages: [],
      mediaPath: null,
      mediaItems: null,
      imageError: '',
      publishStatus: '',
      publishPlatform: null,
    }
  }

  function updatePost(index, patch) {
    setPosts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  function imageDescription(post) {
    return `Crie uma imagem original, profissional e visualmente atraente para acompanhar esta publicação. Escolha a composição mais adequada ao tema e ao ângulo do conteúdo, em formato quadrado ou vertical para feed. Não inclua textos, letras, logotipos, marcas d'água ou interfaces na imagem. A referência abaixo serve apenas para entender a ideia: não copie a legenda nem transforme a instrução em texto dentro da arte.\n\nLegenda da publicação:\n${post.text}\n\nÂngulo da publicação:\n${post.angulo || 'conteúdo educativo e relevante'}`
  }

  function carouselSlideDescription(post, slideIndex, total) {
    const slideRole = slideIndex === 0
      ? 'capa visual, com uma composição forte e simples'
      : slideIndex === total - 1
        ? 'encerramento visual, transmitindo conclusão e convite à ação sem escrever texto'
        : `desenvolvimento visual do ponto ${slideIndex} da sequência`
    return `Crie o slide ${slideIndex + 1} de ${total} de um carrossel profissional para Instagram, em formato vertical 4:5. Todos os slides precisam parecer parte da mesma série: mantenha a mesma paleta de cores, iluminação, estilo fotográfico ou ilustrado e elementos visuais coerentes. Este slide deve ser uma ${slideRole}. Não inclua textos, letras, logotipos, marcas d'água ou interfaces na imagem. A referência abaixo serve apenas para entender a ideia: não copie a legenda nem transforme a instrução em texto dentro da arte.

Legenda da publicação:
${post.text}

Ângulo da publicação:
${post.angulo || 'conteúdo educativo e relevante'}`
  }

  async function requestImage(post, description = imageDescription(post)) {
    const data = await apiFetch('/api/ai/image/generate', {
      method: 'POST',
      timeoutMs: 60_000,
      body: JSON.stringify({ modelo: 'auto', descricao: description }),
    })
    if (!data?.image) throw new Error('O gerador não retornou uma imagem válida.')
    return { imageUrl: data.image, imageModel: data.modelo || 'auto' }
  }

  async function requestCarousel(post, total, onProgress) {
    let completed = 0
    const images = await Promise.all(Array.from({ length: total }, (_, index) => requestImage(post, carouselSlideDescription(post, index, total)).then(result => {
      completed += 1
      onProgress?.(completed)
      return result
    })))
    return {
      carouselImages: images.map(item => item.imageUrl),
      imageModel: images[0]?.imageModel || 'auto',
    }
  }

  async function generateImage(index) {
    const post = posts[index]
    if (!post) return
    const isCarousel = post.visualFormat === 'carousel'
    const total = isCarousel ? Math.min(Math.max(Number(post.carouselCount) || 5, 3), 8) : 1
    setImageLoadingIndex(index)
    setImageLoadingProgress(isCarousel ? { current: 0, total } : null)
    updatePost(index, { imageError: '', publishStatus: '' })
    try {
      const generated = isCarousel
        ? await requestCarousel(post, total, current => setImageLoadingProgress({ current, total }))
        : await requestImage(post)
      updatePost(index, { ...generated, imageUrl: isCarousel ? null : generated.imageUrl, mediaPath: null, mediaItems: null, imageError: '' })
      notify(isCarousel ? `Carrossel com ${total} imagens gerado para a ideia selecionada.` : 'Imagem gerada para a ideia selecionada.')
    } catch (error) {
      updatePost(index, { imageError: error.message || 'Não foi possível gerar a imagem.' })
    } finally {
      setImageLoadingIndex(null)
      setImageLoadingProgress(null)
    }
  }

  async function uploadGeneratedMedia(post) {
    const sourceImages = post.carouselImages?.length ? post.carouselImages : (post.imageUrl ? [post.imageUrl] : [])
    if (!sourceImages.length) throw new Error('Gere uma imagem antes de publicar.')
    if (post.mediaItems?.length) return { mediaPath: post.mediaPath || post.mediaItems[0].path, mediaItems: post.mediaItems, mediaSize: post.mediaItems[0].size }
    const uploadedItems = await Promise.all(sourceImages.map(async (source, index) => {
      const imageBlob = await fetch(source).then(response => {
        if (!response.ok) throw new Error('Não foi possível preparar uma imagem gerada.')
        return response.blob()
      })
      const mimeType = imageBlob.type || 'image/png'
      const signed = await apiFetch('/api/posts/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: `ia-${Date.now()}-${index + 1}.png`, mimetype: mimeType }),
      })
      const uploadResponse = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: imageBlob })
      if (!uploadResponse.ok) throw new Error('Não foi possível enviar uma imagem para publicação.')
      const uploaded = await uploadResponse.json().catch(() => null)
      const mediaUrl = signed.mediaUrl || uploaded?.url
      if (!mediaUrl) throw new Error('O upload de uma imagem não retornou uma URL válida.')
      return { path: mediaUrl, type: 'image', mimetype: mimeType, size: imageBlob.size }
    }))
    return { mediaPath: uploadedItems[0].path, mediaItems: uploadedItems.length > 1 ? uploadedItems : null, mediaSize: uploadedItems[0].size }
  }

  function accountsForPlatform(platform) {
    return connectedAccounts.filter(account => account.platform === platform && account.ativo !== false)
  }

  function accountLabel(account) {
    return account.handle || account.name || account.accountName || `Conta ${account.id}`
  }

  function isPublishPlatformAvailable(platform, targetPost = null) {
    const option = PUBLISH_PLATFORMS.find(item => item.id === platform)
    if (!option || option.videoOnly) return false
    if (targetPost?.visualFormat === 'carousel' && !['instagram', 'tiktok'].includes(platform)) return false
    if (!accountsLoaded || accountsLoadError) return true
    return accountsForPlatform(platform).length > 0
  }

  function openPublishPlatformModal(index) {
    const post = posts[index]
    if (!post) return
    const currentPlatform = post.publishPlatform || post.plataformas?.[0]
    const firstAvailable = PUBLISH_PLATFORMS.find(option => isPublishPlatformAvailable(option.id, post))
    setPublishPlatform(isPublishPlatformAvailable(currentPlatform, post) ? currentPlatform : firstAvailable?.id || 'instagram')
    setPublishModalIndex(index)
  }

  function closePublishPlatformModal() {
    if (publishingIndex === null) setPublishModalIndex(null)
  }

  function publicationStatusFromResponse(data, postId, platforms) {
    const publishedPost = data.posts?.[0]
    return publicationResultMessage({
      event_name: 'post_published',
      payload: {
        id: postId,
        status: publishedPost?.status,
        platforms: publishedPost?.platforms || platforms,
        results: publishedPost?.results || [],
      },
    })
  }

  function finishAiPublication(index, result) {
    const publishStatus = result.type === 'success' ? 'published' : result.type === 'warning' ? 'partial' : 'error'
    updatePost(index, { publishStatus, imageError: result.type === 'success' ? '' : result.message })
    setPublicationProgress('')
    setPublicationDialog(current => current ? { ...current, status: result } : current)
    notify(result.message, result.type === 'success' ? 'success' : 'error')
  }

  function monitorAiPublication(index, postId, initialCursor, platforms) {
    let cursor = initialCursor
    const poll = async () => {
      try {
        const { events = [] } = await apiFetch(`/api/logs/events/since/${cursor}`)
        if (events.length) cursor = Math.max(cursor, ...events.map(event => Number(event.id) || 0))
        const result = findPublicationResult(events, postId)
        if (result) {
          finishAiPublication(index, result)
          return
        }
      } catch {
        // Uma falha pontual não encerra o acompanhamento da publicação.
      }
      publicationPollTimer.current = setTimeout(poll, 4000)
    }
    const labels = platforms.map(platform => PUBLISH_PLATFORMS.find(option => option.id === platform)?.label || platform)
    setPublicationProgress(`Aguardando confirmação de ${labels.join(' e ')}...`)
    poll()
  }

  function confirmPublishPlatform() {
    if (publishModalIndex === null || !isPublishPlatformAvailable(publishPlatform, posts[publishModalIndex]) || (publishPlatform === 'tiktok' && !tiktokPrivacyLevel)) return
    const index = publishModalIndex
    setPublishModalIndex(null)
    publishWithGeneratedImage(index, publishPlatform)
  }

  async function publishWithGeneratedImage(index, selectedPlatform = null) {
    const post = posts[index]
    if (!post) return
    setPublishingIndex(index)
    updatePost(index, { imageError: '', publishStatus: '' })
    try {
      const platform = selectedPlatform || post.publishPlatform || post.plataformas?.[0] || 'instagram'
      const platforms = [platform]
      if (platforms.includes('youtube')) throw new Error('O YouTube exige vídeo. Escolha uma ideia para Instagram, Facebook ou TikTok.')
      const isCarousel = post.visualFormat === 'carousel' && ['instagram', 'tiktok'].includes(platform)
      if (post.visualFormat === 'carousel' && !['instagram', 'tiktok'].includes(platform)) throw new Error('O carrossel pode ser publicado somente no Instagram ou TikTok.')
      updatePost(index, { publishPlatform: platform, plataformas: platforms })
      setPublicationDialog({ index, platforms, status: { type: 'processing', message: processingPublicationMessage(platforms) } })
      setPublicationProgress('Preparando sua publicação...')
      let postWithImage = post
      const hasGeneratedMedia = isCarousel ? postWithImage.carouselImages?.length > 1 : !!postWithImage.imageUrl
      if (!hasGeneratedMedia) {
        const total = Math.min(Math.max(Number(postWithImage.carouselCount) || 5, 3), 8)
        setPublicationProgress(isCarousel ? `Gerando carrossel (0/${total})...` : 'Gerando imagem...')
        const generated = isCarousel
          ? await requestCarousel(postWithImage, total, current => {
              setImageLoadingProgress({ current, total })
              setPublicationProgress(`Gerando carrossel (${current}/${total})...`)
            })
          : await requestImage(postWithImage)
        postWithImage = { ...postWithImage, ...generated, imageUrl: isCarousel ? null : generated.imageUrl }
        updatePost(index, { ...generated, imageUrl: isCarousel ? null : generated.imageUrl })
      }
      setPublicationProgress('Enviando mídia para publicação...')
      const uploadedMedia = await uploadGeneratedMedia(postWithImage)
      updatePost(index, { ...uploadedMedia, imageUrl: postWithImage.imageUrl, carouselImages: postWithImage.carouselImages || [], imageModel: postWithImage.imageModel })
      setPublicationProgress('Enviando publicação para a rede...')
      const eventCursor = await latestPublicationEventId(apiFetch)
      const data = await apiFetch('/api/ai/schedule', {
        method: 'POST',
        timeoutMs: 60_000,
        body: JSON.stringify({
          publishNow: true,
          posts: [{ texto: post.text, titulo: post.titulo || '', plataformas: platforms, horario: new Date().toISOString(), mediaPath: uploadedMedia.mediaPath, mediaItems: uploadedMedia.mediaItems, mediaSize: uploadedMedia.mediaSize, mediaType: 'image', ...(platform === 'tiktok' ? { tiktokPrivacyLevel } : {}) }],
        }),
      })
      const createdPost = data.posts?.[0]
      if (!createdPost?.id) throw new Error('A publicação foi enviada, mas não foi possível acompanhar sua confirmação. Verifique a atividade do Assistente IA.')
      const result = publicationStatusFromResponse(data, createdPost.id, platforms)
      if (result) {
        finishAiPublication(index, result)
      } else {
        updatePost(index, { publishStatus: 'processing' })
        monitorAiPublication(index, createdPost.id, eventCursor, platforms)
      }
    } catch (error) {
      const message = error.message || 'Não foi possível concluir a publicação. Tente novamente.'
      updatePost(index, { imageError: message, publishStatus: 'error' })
      setPublicationProgress('')
      setPublicationDialog(current => current ? { ...current, status: { type: 'error', message } } : current)
      notify(message, 'error')
    } finally {
      setPublishingIndex(null)
    }
  }

  async function loadAnalyticsInsights() {
    setAnalyticsLoading(true); setAnalyticsError('')
    try {
      const data = await apiFetch(`/api/ai/analytics-insights?days=${analyticsDays}`)
      setAnalyticsInsights(data.insights || null)
    } catch (e) { setAnalyticsError(e.message || 'Não foi possível analisar o Analytics.') } finally { setAnalyticsLoading(false) }
  }

  async function clearActivityLogs() {
    if (!activityLogs.length) return
    if (!window.confirm('Limpar o diagnóstico do Assistente de IA?')) return
    try {
      await apiFetch('/api/ai/activity-log', { method: 'DELETE' })
      setActivityLogs([])
      notify('Diagnóstico limpo.')
    } catch (e) {
      notify(e.message || 'Não foi possível limpar o diagnóstico.', 'error')
    }
  }

  function formatMetric(value) {
    return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0)
  }

  function formatRate(value) {
    return `${Number(value || 0).toFixed(2).replace('.', ',')}%`
  }

  function platformSymbol(platform) {
    return ({ instagram: '◎', facebook: 'f', youtube: '▶', tiktok: '♪' })[platform] || '•'
  }

  return <section className={`page-view ai-page${posts.length ? ' has-results' : ' is-empty'}`}><header className="ai-page-intro"><div><p className="eyebrow">ASSISTENTE IA</p><h2>Crie conteúdo com mais agilidade</h2><p>Descreva o que você quer publicar e receba ideias prontas para revisar, adaptar, gerar uma imagem e publicar.</p></div><span className="ai-page-intro-badge"><span aria-hidden="true">✦</span> Seu copiloto de conteúdo</span></header><section className="panel ai-generator-panel">
    <div className="ai-generator-heading"><div><p className="eyebrow">CRIAR CONTEÚDO</p><h2>O que você quer publicar?</h2><p>Quanto mais contexto você informar, mais úteis serão as sugestões.</p></div><span className="ai-generator-icon" aria-hidden="true">✦</span></div>
    <form className="draft-form sched-form" onSubmit={generate}>
      <SchedSection number={1} title="Instrução">
<textarea className="ai-prompt-input" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Ex.: crie 3 ideias sobre educação financeira para jovens adultos" aria-label="Instrução para a IA"/><span className="ai-prompt-help">Você pode pedir qualquer assunto benigno: história, viagem, tecnologia, negócios, cultura, comida ou vários temas juntos. Observação: a IA não é autorizada para temas médicos, jurídicos, adultos/+18 ou análises financeiras aprofundadas.</span>
      </SchedSection>
      <fieldset className="ai-visual-format-picker">
        <legend>Formato visual opcional</legend>
        <div className="ai-visual-format-options">
          <label className={visualFormat === 'single' ? 'is-selected' : ''}><input type="radio" name="ai-visual-format" value="single" checked={visualFormat === 'single'} onChange={() => setVisualFormat('single')} /><span><strong>Imagem única</strong><small>Uma arte para acompanhar a publicação.</small></span></label>
          <label className={visualFormat === 'carousel' ? 'is-selected' : ''}><input type="radio" name="ai-visual-format" value="carousel" checked={visualFormat === 'carousel'} onChange={() => setVisualFormat('carousel')} /><span><strong>Carrossel de fotos</strong><small>Gera uma sequência de 3 a 8 fotos para Instagram ou TikTok.</small></span></label>
        </div>
        {visualFormat === 'carousel' && <label className="ai-carousel-count">Quantidade de slides<select value={carouselCount} onChange={event => setCarouselCount(Number(event.target.value))}>{[3, 4, 5, 6, 7, 8].map(count => <option key={count} value={count}>{count} slides</option>)}</select></label>}
        <p>O carrossel só é criado quando você escolher este formato ou pedir “carrossel” na instrução. A geração consome uma imagem por slide.</p>
      </fieldset>
      <button className="action-button ai-generate-button" disabled={loading || loadingMore}>{loading ? 'Gerando ideias...' : 'Gerar ideias'}</button>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>
  {posts.length > 0 && <section className="panel ai-suggestions-panel">
    <div className="ai-panel-heading"><div><p className="eyebrow">RESULTADOS</p><h2>Sugestões para você</h2><p>Revise o texto, gere uma imagem única ou um carrossel e publique a ideia escolhida.</p></div><span className="ai-result-count">{posts.length} ideias</span></div>
    <div className="ai-suggestion-list">{posts.map((post, index) => <article className="ai-suggestion-card" key={post.id || index}><span className="ai-suggestion-number">{String(index + 1).padStart(2, '0')}</span><div className="ai-suggestion-body">
      {editingIndex === index
        ? <textarea className="ai-suggestion-editor" value={post.text} onChange={event => setPosts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} aria-label={`Editar sugestão ${index + 1}`} />
        : <p>{post.text}</p>}
      <div className="ai-suggestion-actions" aria-label={`Ações da sugestão ${index + 1}`}>
        <div className="ai-suggestion-secondary-actions">
          <button type="button" className="ai-suggestion-action-button ai-edit-button" onClick={() => setEditingIndex(editingIndex === index ? null : index)}><span className="ai-suggestion-action-icon" aria-hidden="true">✎</span><span>{editingIndex === index ? 'Concluir edição' : 'Editar texto'}</span></button>
          <button type="button" className="ai-suggestion-action-button ai-image-button" onClick={() => generateImage(index)} disabled={imageLoadingIndex !== null || publishingIndex !== null}><span className="ai-suggestion-action-icon" aria-hidden="true">✦</span><span>{imageLoadingIndex === index ? (post.visualFormat === 'carousel' ? `Gerando carrossel ${imageLoadingProgress?.current || 0}/${imageLoadingProgress?.total || post.carouselCount}...` : 'Gerando imagem...') : post.visualFormat === 'carousel' ? (post.carouselImages?.length ? 'Gerar outro carrossel' : 'Gerar carrossel') : post.imageUrl ? 'Gerar outra imagem' : 'Gerar imagem'}</span></button>
        </div>
        <button type="button" className="ai-suggestion-action-button ai-publish-image-button ai-suggestion-primary-action" onClick={() => openPublishPlatformModal(index)} disabled={publishingIndex !== null || imageLoadingIndex !== null || post.publishStatus === 'published'}><span className="ai-suggestion-action-icon" aria-hidden="true">↗</span><span>{publishingIndex === index ? (post.visualFormat === 'carousel' ? 'Gerando e publicando carrossel...' : post.imageUrl ? 'Publicando...' : 'Gerando e publicando...') : post.publishStatus === 'published' ? 'Publicado' : post.visualFormat === 'carousel' ? (post.carouselImages?.length ? 'Publicar carrossel' : 'Gerar carrossel e publicar') : post.imageUrl ? 'Publicar agora' : 'Gerar imagem e publicar'}</span></button>
      </div>
      {post.carouselImages?.length > 0
        ? <div className="ai-generated-media ai-generated-carousel"><div className="ai-carousel-grid">{post.carouselImages.map((image, imageIndex) => <img key={`${image}-${imageIndex}`} src={image} alt={`Slide ${imageIndex + 1} do carrossel da ideia ${index + 1}`} />)}</div><small>Carrossel com {post.carouselImages.length} slides{post.imageModel ? ` · criado com ${post.imageModel}.` : ' · gerado pela IA.'}</small></div>
        : post.imageUrl && <div className="ai-generated-media"><img src={post.imageUrl} alt={`Imagem gerada para a ideia ${index + 1}`} /><small>{post.imageModel ? `Imagem criada com ${post.imageModel}.` : 'Imagem gerada pela IA.'}</small></div>}
      {post.imageError && <p className="ai-image-error" role="alert">{post.imageError}</p>}
      {post.publishStatus && post.publishStatus !== 'published' && <p className={`ai-publish-status ai-publish-status-${post.publishStatus}`}>Status da publicação: {post.publishStatus === 'processing' ? 'aguardando confirmação da rede' : post.publishStatus === 'partial' ? 'publicada parcialmente' : 'não foi possível concluir'}.</p>}
    </div></article>)}</div>
    <button type="button" className="action-button ai-generate-more-button" onClick={generateMore} disabled={loadingMore || loading}>{loadingMore ? 'Gerando mais ideias...' : 'Gerar mais ideias sobre este assunto'}</button>
  </section>}
  {publishModalIndex !== null && <div className="modal-overlay ai-publish-platform-overlay" onMouseDown={event => event.target === event.currentTarget && closePublishPlatformModal()}>
    <section className="modal-content ai-publish-platform-modal" role="dialog" aria-modal="true" aria-labelledby="ai-publish-platform-title" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">PUBLICAR AGORA</p><h3 id="ai-publish-platform-title">Escolha a rede social</h3></div><button type="button" className="link-button" onClick={closePublishPlatformModal} aria-label="Fechar">✕</button></div>
      <p className="ai-publish-platform-copy">Selecione onde esta sugestão deve ser publicada. A publicação será enviada somente para a rede escolhida.</p>
      <div className="platform-options ai-publish-platform-options" role="radiogroup" aria-label="Rede social para publicação">
        {PUBLISH_PLATFORMS.map(option => {
          const accounts = accountsForPlatform(option.id)
          const targetPost = posts[publishModalIndex]
          const unavailable = !isPublishPlatformAvailable(option.id, targetPost)
          const accountText = accounts.length
            ? accounts.slice(0, 2).map(accountLabel).join(', ')
            : accountsLoaded && !accountsLoadError ? 'Nenhuma conta conectada' : 'Verificando contas conectadas...'
          return <label key={option.id} className={`platform-option platform-option-${option.id}${unavailable ? ' is-disabled' : ''}`}>
            <input type="radio" name="ai-publish-platform" value={option.id} checked={publishPlatform === option.id} onChange={() => setPublishPlatform(option.id)} disabled={unavailable} />
            <span className="platform-option-icon" aria-hidden="true">{option.symbol}</span><span className="platform-option-name">{option.label}</span><span className="platform-option-hint">{option.videoOnly ? 'Disponível no Meu Post com vídeo' : option.hint}</span><span className="platform-option-account">{accountText}{accounts.length > 2 ? ` +${accounts.length - 2}` : ''}</span><span className="platform-option-check" aria-hidden="true">✓</span>
          </label>
        })}
      </div>
      {posts[publishModalIndex]?.visualFormat === 'carousel' && <p className="ai-carousel-publish-note">Carrosséis são publicados como uma única publicação no Instagram ou TikTok, mantendo a ordem dos slides.</p>}
      {publishPlatform === 'tiktok' && <label className="ai-tiktok-privacy-field">Privacidade do TikTok<select value={tiktokPrivacyLevel} onChange={event => setTiktokPrivacyLevel(event.target.value)}><option value="">Selecione...</option><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="FOLLOWER_OF_CREATOR">Seguidores do criador</option><option value="SELF_ONLY">Somente eu</option></select></label>}
      <div className="ai-publish-platform-actions"><button type="button" className="secondary-button" onClick={closePublishPlatformModal}>Cancelar</button><button type="button" className="action-button" onClick={confirmPublishPlatform} disabled={!isPublishPlatformAvailable(publishPlatform, posts[publishModalIndex])}>{posts[publishModalIndex]?.visualFormat === 'carousel' ? (posts[publishModalIndex]?.carouselImages?.length ? 'Publicar carrossel' : 'Gerar carrossel e publicar') : posts[publishModalIndex]?.imageUrl ? 'Publicar agora' : 'Gerar imagem e publicar'}</button></div>
    </section>
  </div>}
  {publicationDialog && <PublicationStatusModal status={publicationDialog.status} platforms={publicationDialog.platforms} progress={publicationProgress} onReview={() => setPublicationDialog(null)} onClose={() => setPublicationDialog(null)}/>}
  <section className="panel ai-analytics-insights-panel">
    <div className="ai-panel-heading ai-analytics-insights-heading"><div><p className="eyebrow">INTELIGÊNCIA DE PERFORMANCE</p><h2>O que está acontecendo no seu Analytics?</h2><p>A IA cruza suas métricas reais para indicar quando publicar e qual perfil está evoluindo melhor dentro de cada nicho.</p></div><span className="ai-analytics-insights-icon" aria-hidden="true">◒</span></div>
    <div className="ai-analytics-controls"><label>Período<select value={analyticsDays} onChange={event => setAnalyticsDays(Number(event.target.value))}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></select></label><button type="button" className="action-button ai-analytics-button" onClick={loadAnalyticsInsights} disabled={analyticsLoading}>{analyticsLoading ? 'Analisando...' : 'Analisar Analytics'}</button></div>
    {analyticsError && <p className="error-message" role="alert">{analyticsError}</p>}
    {!analyticsInsights && !analyticsLoading && !analyticsError && <div className="ai-analytics-empty"><span aria-hidden="true">✦</span><div><strong>Descubra o melhor momento para publicar</strong><p>Escolha o período e deixe a IA transformar seus dados em decisões práticas.</p></div></div>}
    {analyticsInsights && <div className="ai-analytics-insights-content">
      <div className="ai-analytics-summary"><span className="ai-analytics-summary-mark" aria-hidden="true">✓</span><p>{analyticsInsights.summary}</p></div>
      {analyticsInsights.performanceAnalysis?.comparisons?.length > 0 && <section className="ai-performance-analysis" aria-labelledby="ai-performance-analysis-title"><div className="analytics-section-heading"><div><span className="ai-analytics-card-kicker">COMPARAÇÃO DE VISUALIZAÇÕES</span><h3 id="ai-performance-analysis-title">Por que um post foi melhor que outro?</h3></div><small>Correlação, não causalidade</small></div>{analyticsInsights.performanceAnalysis.comparisons.map(item => <article className="ai-performance-comparison" key={item.platform}><div className="ai-performance-comparison-heading"><strong>{item.platformLabel}</strong><span>{item.sampleSize} publicação(ões) · confiança {item.confidence}</span></div><p>{item.diagnosis}</p><div className="ai-performance-actions"><div><b>Solução recomendada</b><span>{item.solution}</span></div><div><b>Outra abordagem</b><span>{item.alternativeApproach}</span></div></div></article>)}</section>}
      <div className="ai-analytics-highlight-grid">
        <article className="ai-analytics-highlight-card is-gold"><span className="ai-analytics-card-kicker">MELHOR HORÁRIO</span>{analyticsInsights.bestTime ? <><strong>{analyticsInsights.bestTime.hour}h · {analyticsInsights.bestTime.period}</strong><span>{analyticsInsights.bestTime.day} no {analyticsInsights.bestTime.platformLabel}</span><small>{formatMetric(analyticsInsights.bestTime.averageInteractions)} de interação média · {analyticsInsights.bestTime.postCount || 0} publicação(ões)</small></> : <><strong>Dados insuficientes</strong><span>Publique mais vezes para identificar um padrão.</span></>}</article>
        <article className="ai-analytics-highlight-card"><span className="ai-analytics-card-kicker">PERÍODO DO DIA</span><strong>{analyticsInsights.bestPeriod || 'Ainda não identificado'}</strong><span>{analyticsInsights.bestPeriod ? 'É o período com melhor sinal no histórico analisado.' : 'Ainda não há horários suficientes para comparar.'}</span><small>Baseado nas métricas do período selecionado</small></article>
      </div>
      <div className="ai-analytics-columns">
        <div className="ai-analytics-block"><div className="ai-analytics-block-heading"><div><span className="ai-analytics-card-kicker">COMPARAÇÃO DE PERFIS</span><strong>Quem está se saindo melhor?</strong></div><small>{analyticsInsights.profileComparison.length} perfil(is)</small></div>{analyticsInsights.profileComparison.length ? <div className="ai-profile-comparison-list">{analyticsInsights.profileComparison.map((profile, index) => <div className="ai-profile-comparison-row" key={profile.id}><span className="ai-profile-rank">{String(index + 1).padStart(2, '0')}</span><span className={`ai-profile-network ai-profile-network-${profile.platform}`} aria-hidden="true">{platformSymbol(profile.platform)}</span><div className="ai-profile-comparison-main"><strong>{profile.name}</strong><small>{profile.platformLabel} · {profile.niche}</small></div><div className="ai-profile-comparison-metrics"><strong>{formatRate(profile.engagementRate)}</strong><small>{formatMetric(profile.interactions)} interações</small></div></div>)}</div> : <p className="ai-analytics-no-data">Nenhum perfil com métricas disponíveis neste período.</p>}</div>
        <div className="ai-analytics-block"><div className="ai-analytics-block-heading"><div><span className="ai-analytics-card-kicker">DESEMPENHO POR NICHO</span><strong>Referências para crescer</strong></div></div>{analyticsInsights.nicheComparisons.length ? <div className="ai-niche-comparison-list">{analyticsInsights.nicheComparisons.map(item => <div className="ai-niche-comparison-card" key={item.niche}><span>{item.niche}</span><strong>{item.winner?.name || 'Sem vencedor'}</strong><small>{item.winner ? `${formatRate(item.winner.engagementRate)} de interação · ${item.winner.platformLabel}` : 'Sem dados suficientes'}</small></div>)}</div> : <p className="ai-analytics-no-data">Ainda não foi possível identificar um nicho com segurança.</p>}</div>
      </div>
      <div className="ai-analytics-recommendations"><span className="ai-analytics-card-kicker">PRÓXIMAS AÇÕES</span>{analyticsInsights.recommendations.map((recommendation, index) => <p key={index}><b>{index + 1}</b>{recommendation}</p>)}</div>
      <p className="ai-analytics-data-note">Análise baseada em {analyticsInsights.dataQuality.publications} publicação(ões), {analyticsInsights.dataQuality.profiles} perfil(is) e {analyticsInsights.dataQuality.timeSlots} faixa(s) de horário. O nicho é estimado a partir dos textos publicados.</p>
    </div>}
  </section>
  <section className="panel ai-logs-panel">
    <div className="ai-panel-heading"><div><p className="eyebrow">DIAGNÓSTICO</p><h2>Atividade do agente</h2><p>Acompanhe as últimas execuções realizadas pelo Assistente IA.</p></div><div className="ai-logs-actions"><button type="button" className="ai-refresh-button link-button" onClick={() => apiFetch('/api/ai/activity-log?limit=20').then(data => setActivityLogs(data.logs || []))}>Atualizar</button><button type="button" className="ai-clear-button link-button" onClick={clearActivityLogs} disabled={!activityLogs.length}>Limpar</button></div></div>
    {activityLogs.length ? <div className="ai-log-list">{activityLogs.map(log => { const activity = formatAiActivity(log); return <div className="ai-log-row" key={log.id}><span className={`ai-log-status ai-log-status-${log.status === 'success' || log.status === 'ok' ? 'ok' : 'info'}`} aria-hidden="true">{log.status === 'success' || log.status === 'ok' ? '✓' : '·'}</span><div><strong>{activity.title}</strong><small>{activity.details} · {new Date(log.criadoEm).toLocaleString('pt-BR')}</small></div><span className="ai-log-status-label">{log.status}</span></div> })}</div> : <p className="empty-state">Nenhum registro do agente ainda.</p>}
  </section>
  </section>
}
