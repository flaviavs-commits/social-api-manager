import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { AiModelPicker } from '../components/ai/ai-model-picker.jsx'
import { useToast } from '../components/ui/toast.jsx'
import '../styles/ai-page-publish.css'

// O backend espera até 45s pelo provedor. O OpenRouter pode precisar de alguns
// segundos adicionais para devolver a resposta ou o fallback do servidor.
const AI_GENERATION_TIMEOUT_MS = 60_000
const PUBLISH_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', symbol: '◎', hint: 'Imagem obrigatória' },
  { id: 'facebook', label: 'Facebook', symbol: 'f', hint: 'Imagem opcional' },
  { id: 'tiktok', label: 'TikTok', symbol: '♪', hint: 'Imagem ou vídeo obrigatório' },
  { id: 'youtube', label: 'YouTube', symbol: '▶', hint: 'Exige vídeo', videoOnly: true },
]

export function AiPage() {
  const [instruction, setInstruction] = useState('')
  const [posts, setPosts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [activityLogs, setActivityLogs] = useState([])
  const [modelo, setModelo] = useState('local')
  const [analyticsInsights, setAnalyticsInsights] = useState(null)
  const [analyticsDays, setAnalyticsDays] = useState(30)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const [imageLoadingIndex, setImageLoadingIndex] = useState(null)
  const [publishingIndex, setPublishingIndex] = useState(null)
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountsLoadError, setAccountsLoadError] = useState(false)
  const [publishModalIndex, setPublishModalIndex] = useState(null)
  const [publishPlatform, setPublishPlatform] = useState('instagram')
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

  async function generate(event) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const data = await apiFetch('/api/ai/generate', { method: 'POST', timeoutMs: AI_GENERATION_TIMEOUT_MS, body: JSON.stringify({ instrucao: instruction, plataformas: ['instagram'], quantidade: 3, tom: 'profissional', modelo }) })
      setPosts((data.posts || []).map(post => normalizePost(post)))
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
      const data = await apiFetch('/api/ai/generate', { method: 'POST', timeoutMs: AI_GENERATION_TIMEOUT_MS, body: JSON.stringify({ instrucao: instruction, plataformas: ['instagram'], quantidade: 3, tom: 'profissional', modelo }) })
      const novos = (data.posts || []).map(post => normalizePost(post))
      setPosts(current => [...current, ...novos])
    } catch (e) { setError(e.message) } finally { setLoadingMore(false) }
  }

  function normalizePost(post) {
    return { ...post, text: post.texto || post.text || post.caption || '', imageUrl: null, mediaPath: null, imageError: '', publishStatus: '', publishPlatform: null }
  }

  function updatePost(index, patch) {
    setPosts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  function imageDescription(post) {
    return `Crie uma imagem original, profissional e visualmente atraente para acompanhar esta publicação. Escolha a composição mais adequada ao tema e ao ângulo do conteúdo, em formato quadrado ou vertical para feed. Não inclua textos, letras, logotipos, marcas d'água ou interfaces na imagem. A referência abaixo serve apenas para entender a ideia: não copie a legenda nem transforme a instrução em texto dentro da arte.\n\nLegenda da publicação:\n${post.text}\n\nÂngulo da publicação:\n${post.angulo || 'conteúdo educativo e relevante'}`
  }

  async function requestImage(post) {
    const data = await apiFetch('/api/ai/image/generate', {
      method: 'POST',
      timeoutMs: 60_000,
      body: JSON.stringify({ modelo: 'auto', descricao: imageDescription(post) }),
    })
    if (!data?.image) throw new Error('O gerador não retornou uma imagem válida.')
    return { imageUrl: data.image, imageModel: data.modelo || 'auto' }
  }

  async function generateImage(index) {
    const post = posts[index]
    if (!post) return
    setImageLoadingIndex(index)
    updatePost(index, { imageError: '', publishStatus: '' })
    try {
      const generated = await requestImage(post)
      updatePost(index, { ...generated, mediaPath: null, imageError: '' })
      notify('Imagem gerada para a ideia selecionada.')
    } catch (error) {
      updatePost(index, { imageError: error.message || 'Não foi possível gerar a imagem.' })
    } finally {
      setImageLoadingIndex(null)
    }
  }

  async function uploadGeneratedImage(post) {
    if (post.mediaPath) return post.mediaPath
    if (!post.imageUrl) throw new Error('Gere uma imagem antes de publicar.')
    const imageBlob = await fetch(post.imageUrl).then(response => {
      if (!response.ok) throw new Error('Não foi possível preparar a imagem gerada.')
      return response.blob()
    })
    const mimeType = imageBlob.type || 'image/png'
    const signed = await apiFetch('/api/posts/upload-url', {
      method: 'POST',
      body: JSON.stringify({ filename: `ia-${Date.now()}.png`, mimetype: mimeType }),
    })
    const uploadResponse = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: imageBlob })
    if (!uploadResponse.ok) throw new Error('Não foi possível enviar a imagem para publicação.')
    const uploaded = await uploadResponse.json().catch(() => null)
    if (!uploaded?.url) throw new Error('O upload da imagem não retornou uma URL válida.')
    return uploaded.url
  }

  function accountsForPlatform(platform) {
    return connectedAccounts.filter(account => account.platform === platform && account.ativo !== false)
  }

  function accountLabel(account) {
    return account.handle || account.name || account.accountName || `Conta ${account.id}`
  }

  function isPublishPlatformAvailable(platform) {
    const option = PUBLISH_PLATFORMS.find(item => item.id === platform)
    if (!option || option.videoOnly) return false
    if (!accountsLoaded || accountsLoadError) return true
    return accountsForPlatform(platform).length > 0
  }

  function openPublishPlatformModal(index) {
    const post = posts[index]
    if (!post) return
    const currentPlatform = post.publishPlatform || post.plataformas?.[0]
    const firstAvailable = PUBLISH_PLATFORMS.find(option => isPublishPlatformAvailable(option.id))
    setPublishPlatform(isPublishPlatformAvailable(currentPlatform) ? currentPlatform : firstAvailable?.id || 'instagram')
    setPublishModalIndex(index)
  }

  function closePublishPlatformModal() {
    if (publishingIndex === null) setPublishModalIndex(null)
  }

  function confirmPublishPlatform() {
    if (publishModalIndex === null || !isPublishPlatformAvailable(publishPlatform)) return
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
      updatePost(index, { publishPlatform: platform, plataformas: platforms })
      let postWithImage = post
      if (!postWithImage.imageUrl) {
        const generated = await requestImage(postWithImage)
        postWithImage = { ...postWithImage, ...generated }
        updatePost(index, { ...generated })
      }
      const mediaPath = await uploadGeneratedImage(postWithImage)
      updatePost(index, { mediaPath, imageUrl: postWithImage.imageUrl, imageModel: postWithImage.imageModel })
      const data = await apiFetch('/api/ai/schedule', {
        method: 'POST',
        timeoutMs: 60_000,
        body: JSON.stringify({
          publishNow: true,
          posts: [{ texto: post.text, titulo: post.titulo || '', plataformas, horario: new Date().toISOString(), mediaPath, mediaType: 'image' }],
        }),
      })
      const status = data.posts?.[0]?.status || 'processing'
      updatePost(index, { publishStatus: status })
      notify(status === 'published' ? 'Post publicado com a imagem gerada.' : 'Post enviado para publicação. A rede ainda está processando a mídia.')
    } catch (error) {
      updatePost(index, { imageError: error.message || 'Não foi possível publicar esta ideia.' })
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
        <textarea className="ai-prompt-input" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Ex.: crie 3 ideias sobre educação financeira para jovens adultos" aria-label="Instrução para a IA"/><span className="ai-prompt-help">Inclua tema, público, objetivo, tom de voz ou rede social.</span>
      </SchedSection>
      <AiModelPicker value={modelo} onChange={setModelo} />
      <button className="action-button ai-generate-button" disabled={loading || loadingMore}>{loading ? 'Gerando ideias...' : 'Gerar ideias'}</button>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>
  {posts.length > 0 && <section className="panel ai-suggestions-panel">
    <div className="ai-panel-heading"><div><p className="eyebrow">RESULTADOS</p><h2>Sugestões para você</h2><p>Revise o texto, gere uma imagem quando fizer sentido e publique a ideia escolhida.</p></div><span className="ai-result-count">{posts.length} ideias</span></div>
    <div className="ai-suggestion-list">{posts.map((post, index) => <article className="ai-suggestion-card" key={post.id || index}><span className="ai-suggestion-number">{String(index + 1).padStart(2, '0')}</span><div className="ai-suggestion-body">
      {editingIndex === index
        ? <textarea className="ai-suggestion-editor" value={post.text} onChange={event => setPosts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} aria-label={`Editar sugestão ${index + 1}`} />
        : <p>{post.text}</p>}
      <div className="ai-suggestion-actions" aria-label={`Ações da sugestão ${index + 1}`}>
        <div className="ai-suggestion-secondary-actions">
          <button type="button" className="ai-suggestion-action-button ai-edit-button" onClick={() => setEditingIndex(editingIndex === index ? null : index)}><span className="ai-suggestion-action-icon" aria-hidden="true">✎</span><span>{editingIndex === index ? 'Concluir edição' : 'Editar texto'}</span></button>
          <button type="button" className="ai-suggestion-action-button ai-image-button" onClick={() => generateImage(index)} disabled={imageLoadingIndex !== null || publishingIndex !== null}><span className="ai-suggestion-action-icon" aria-hidden="true">✦</span><span>{imageLoadingIndex === index ? 'Gerando imagem...' : post.imageUrl ? 'Gerar outra imagem' : 'Gerar imagem'}</span></button>
        </div>
        <button type="button" className="ai-suggestion-action-button ai-publish-image-button ai-suggestion-primary-action" onClick={() => openPublishPlatformModal(index)} disabled={publishingIndex !== null || imageLoadingIndex !== null || post.publishStatus === 'published'}><span className="ai-suggestion-action-icon" aria-hidden="true">↗</span><span>{publishingIndex === index ? (post.imageUrl ? 'Publicando...' : 'Gerando e publicando...') : post.publishStatus === 'published' ? 'Publicado' : post.imageUrl ? 'Publicar agora' : 'Gerar imagem e publicar'}</span></button>
      </div>
      {post.imageUrl && <div className="ai-generated-media"><img src={post.imageUrl} alt={`Imagem gerada para a ideia ${index + 1}`} /><small>{post.imageModel ? `Imagem criada com ${post.imageModel}.` : 'Imagem gerada pela IA.'}</small></div>}
      {post.imageError && <p className="ai-image-error" role="alert">{post.imageError}</p>}
      {post.publishStatus && post.publishStatus !== 'published' && <p className="ai-publish-status">Status da publicação: {post.publishStatus === 'processing' ? 'processando pela rede' : post.publishStatus}.</p>}
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
          const unavailable = !isPublishPlatformAvailable(option.id)
          const accountText = accounts.length
            ? accounts.slice(0, 2).map(accountLabel).join(', ')
            : accountsLoaded && !accountsLoadError ? 'Nenhuma conta conectada' : 'Verificando contas conectadas...'
          return <label key={option.id} className={`platform-option platform-option-${option.id}${unavailable ? ' is-disabled' : ''}`}>
            <input type="radio" name="ai-publish-platform" value={option.id} checked={publishPlatform === option.id} onChange={() => setPublishPlatform(option.id)} disabled={unavailable} />
            <span className="platform-option-icon" aria-hidden="true">{option.symbol}</span><span className="platform-option-name">{option.label}</span><span className="platform-option-hint">{option.videoOnly ? 'Disponível no Criador de Posts com vídeo' : option.hint}</span><span className="platform-option-account">{accountText}{accounts.length > 2 ? ` +${accounts.length - 2}` : ''}</span><span className="platform-option-check" aria-hidden="true">✓</span>
          </label>
        })}
      </div>
      <div className="ai-publish-platform-actions"><button type="button" className="secondary-button" onClick={closePublishPlatformModal}>Cancelar</button><button type="button" className="action-button" onClick={confirmPublishPlatform} disabled={!isPublishPlatformAvailable(publishPlatform)}>{posts[publishModalIndex]?.imageUrl ? 'Publicar agora' : 'Gerar imagem e publicar'}</button></div>
    </section>
  </div>}
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
    <div className="ai-panel-heading"><div><p className="eyebrow">DIAGNÓSTICO</p><h2>Atividade do agente</h2><p>Acompanhe as últimas execuções realizadas pelo Assistente IA.</p></div><button type="button" className="ai-refresh-button link-button" onClick={() => apiFetch('/api/ai/activity-log?limit=20').then(data => setActivityLogs(data.logs || []))}>Atualizar</button></div>
    {activityLogs.length ? <div className="ai-log-list">{activityLogs.map(log => <div className="ai-log-row" key={log.id}><span className={`ai-log-status ai-log-status-${log.status === 'success' || log.status === 'ok' ? 'ok' : 'info'}`} aria-hidden="true">{log.status === 'success' || log.status === 'ok' ? '✓' : '·'}</span><div><strong>{log.acao}{log.modelo ? ` · ${log.modelo}` : ''}</strong><small>{log.detalhes || 'Sem detalhes'} · {new Date(log.criadoEm).toLocaleString('pt-BR')}</small></div><span className="ai-log-status-label">{log.status}</span></div>)}</div> : <p className="empty-state">Nenhum registro do agente ainda.</p>}
  </section>
  </section>
}
