import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { OnboardingChecklist } from '../components/ui/onboarding-checklist.jsx'

const STATUS_LABELS = { scheduled: 'Agendada', agendado: 'Agendada', published: 'Publicada', publicado: 'Publicado', failed: 'Falhou', erro: 'Falhou', error: 'Falhou', partial: 'Parcial', processing: 'Processando' }
const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const ACTIVITY_FILTER_KEY = 'meu-ecoo:dashboard-activity-filter'
const DASHBOARD_PLATFORMS = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']]
const PERFORMANCE_PLATFORM_FILTERS = [['all', 'Todas as redes'], ...DASHBOARD_PLATFORMS]
const PERFORMANCE_PERIODS = [7, 15, 30]
const ANALYTICS_RETRY_BASE_MS = 5000
const ANALYTICS_RETRY_MAX_MS = 60000
const PLATFORM_LABELS = Object.fromEntries(DASHBOARD_PLATFORMS)

function formatPostDate(value) {
  if (!value) return 'Sem data definida'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Sem data definida' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function postDateValue(post) {
  return post.scheduledAt || post.scheduled_at || post.data_agendamento || post.publishedAt || post.published_at || ''
}

function postPlatforms(post) {
  return post.platforms || post.plataformas || (post.platform ? [post.platform] : [])
}

function metricValue(metrics, name) {
  const value = metrics?.[name]
  const normalized = value && typeof value === 'object' ? value.total : value
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function engagementValue(metrics) {
  return ['likes', 'comments', 'shares', 'saves'].reduce((total, name) => total + metricValue(metrics, name), 0)
}

function compactNumber(value) {
  const number = Number(value || 0)
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace('.0', '')} mi`
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace('.0', '')} mil`
  return String(number)
}

function failureDiagnosis(post) {
  const message = String(post.errorMessage || post.error_message || '').trim()
  const normalized = message.toLowerCase()
  const isTransientNetworkFailure = /respondeu\s+(408|425|429|500|502|503|504|529)|(?:http|status|c[oó]digo)\s*[=:]?\s*(408|425|429|500|502|503|504|529)\b|rate.?limit|too many requests|timeout|timed out|econnreset|etimedout|enotfound|fetch failed|network|networkerror|conex[aã]o.*(?:interromp|falh|indispon)|temporariamente indispon[ií]vel|service unavailable|gateway timeout|zernio.*(?:indispon|falh)/.test(normalized)
  if (isTransientNetworkFailure) {
    const reason = /rate.?limit|too many requests|\b429\b/.test(normalized)
      ? 'A rede social limitou temporariamente as publicações desta conta.'
      : /timeout|timed out|econnreset|etimedout|enotfound|fetch failed|network|networkerror|conex[aã]o/.test(normalized)
        ? 'A conexão com a rede social foi interrompida antes da confirmação.'
        : 'A rede social está temporariamente instável ou indisponível.'
    return {
      label: 'Falha temporária',
      className: 'is-network',
      retryable: true,
      reason,
      nextStep: 'Revise o conteúdo se quiser e publique novamente quando a conexão ou a rede voltar ao normal.'
    }
  }
  if (/token|autoriz|permiss|access|\b401\b|\b403\b|reconect/.test(normalized)) {
    return {
      label: 'Conta precisa de atenção',
      className: 'is-system',
      retryable: false,
      reason: 'A conta não autorizou esta publicação ou perdeu o acesso à rede social.',
      nextStep: 'Reconecte ou renove a conta em Integrações antes de tentar publicar novamente.'
    }
  }
  if (/exception|stack|cannot read|undefined|internal|database|sql|programa|servidor/.test(normalized)) {
    return {
      label: 'Possível falha do sistema',
      className: 'is-system',
      retryable: false,
      reason: message || 'O processamento interno não conseguiu concluir a publicação.',
      nextStep: 'Aguarde e tente novamente mais tarde. Se persistir, envie este registro ao suporte.'
    }
  }
  if (/imagem|image|vídeo|video|mídia|media|formato|tamanho|caract|caption|texto|obrigat|conteúdo|content|already\s+(?:scheduled|published|posted)|already.*(?:publish|schedule)|exact\s+content|same\s+content|duplicate|duplicad|já\s+(?:está|foi)\s+(?:agendad|publicad)|conteúdo\s+duplicado/.test(normalized)) {
    return {
      label: 'Conteúdo ou configuração',
      className: 'is-content',
      retryable: true,
      reason: message || 'O conteúdo ou alguma configuração não atende aos requisitos da rede.',
      nextStep: 'Abra o editor, corrija mídia, texto ou configurações específicas da plataforma e publique novamente.'
    }
  }
  return {
    label: 'Origem não conclusiva',
    className: 'is-unknown',
    retryable: false,
    reason: message || 'A publicação foi marcada como falha, mas não há detalhes suficientes no registro.',
    nextStep: 'Confira Integrações e o histórico da publicação. O editor só fica disponível quando a falha puder ser corrigida no conteúdo.'
  }
}

function shortPostDate(post) {
  const value = postDateValue(post)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'data não informada' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function reviewAlertMessage(post, diagnosis) {
  const platform = PLATFORM_LABELS[postPlatforms(post)[0]] || 'rede social'
  const postLabel = `o post #${post.id} do dia ${shortPostDate(post)}`
  if (diagnosis.className === 'is-content') {
    return `Revisar ${postLabel}: é possível que não tenha sido publicado porque o tamanho ou formato da imagem está fora do padrão do ${platform}.`
  }
  return `Revisar ${postLabel}: é possível que não tenha sido publicado por uma falha no ${platform}.`
}

function bestObservedHour(rows) {
  const byHour = {}
  rows.forEach(row => {
    const date = new Date(row.publishedAt)
    if (Number.isNaN(date.getTime())) return
    const hour = date.getHours()
    byHour[hour] = (byHour[hour] || 0) + engagementValue(row.metrics)
  })
  const best = Object.entries(byHour).sort(([, a], [, b]) => b - a)[0]
  if (!best || !best[1]) return null
  const hour = Number(best[0])
  return `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`
}

function bestProviderTime(accountAnalytics, platform = 'all') {
  const slots = (accountAnalytics?.bestTimeToPost || [])
    .filter(item => platform === 'all' || [item.platform, item.network, item.data?.platform].includes(platform))
    .flatMap(item => item.data?.slots || [])
  const best = [...slots].sort((a, b) => Number(b.avg_engagement || 0) - Number(a.avg_engagement || 0))[0]
  if (!best || best.hour == null) return null
  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  return `${days[Number(best.day_of_week)] || 'melhor dia'}, ${String(best.hour).padStart(2, '0')}h (UTC)`
}

export function DashboardPage({ onNavigate }) {
  const [data, setData] = useState({ posts: [], accounts: [] })
  const [postsError, setPostsError] = useState('')
  const [accountsError, setAccountsError] = useState('')
  const [analytics, setAnalytics] = useState(null)
  const [analyticsPeriodDays, setAnalyticsPeriodDays] = useState(7)
  const [analyticsPlatform, setAnalyticsPlatform] = useState('all')
  const [analyticsError, setAnalyticsError] = useState('')
  const [postsLoading, setPostsLoading] = useState(true)
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsRetry, setAnalyticsRetry] = useState(0)
  const [activityFilter, setActivityFilter] = useState(() => localStorage.getItem(ACTIVITY_FILTER_KEY) || 'all')
  const [activitySearch, setActivitySearch] = useState('')
  const [deletingPostId, setDeletingPostId] = useState(null)

  useEffect(() => { localStorage.setItem(ACTIVITY_FILTER_KEY, activityFilter) }, [activityFilter])

  useEffect(() => {
    let active = true
    setPostsLoading(true)
    setAccountsLoading(true)
    apiFetch('/api/posts')
      .then(posts => { if (active) setData(current => ({ ...current, posts: posts.posts || posts || [] })) })
      .catch(error => { if (active) setPostsError(error.message) })
      .finally(() => { if (active) setPostsLoading(false) })
    apiFetch('/api/accounts')
      .then(accounts => { if (active) setData(current => ({ ...current, accounts: accounts.accounts || accounts.data || accounts || [] })) })
      .catch(error => { if (active) setAccountsError(error.message) })
      .finally(() => { if (active) setAccountsLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    let retryTimer = null
    let retryAttempt = 0
    setAnalyticsLoading(true)
    setAnalyticsError('')

    function loadAnalytics() {
      // Esse endpoint agrega métricas ao vivo de várias contas/plataformas
      // (Zernio + APIs nativas), podendo levar bem mais que o timeout padrão
      // de 15s da apiFetch em contas com várias publicações no período.
      apiFetch(`/api/posts/analytics?days=${analyticsPeriodDays}`, { timeoutMs: 45_000 })
        .then(result => {
          if (!active) return
          retryAttempt = 0
          setAnalytics(result)
          setAnalyticsError('')
        })
        .catch(error => {
          if (!active) return
          setAnalyticsError(error.message)
          retryAttempt += 1
          const delay = Math.min(ANALYTICS_RETRY_MAX_MS, ANALYTICS_RETRY_BASE_MS * (2 ** Math.min(retryAttempt - 1, 4)))
          retryTimer = window.setTimeout(loadAnalytics, delay)
        })
        .finally(() => { if (active) setAnalyticsLoading(false) })
    }

    loadAnalytics()
    return () => {
      active = false
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [analyticsPeriodDays, analyticsRetry])

  const scheduled = data.posts.filter(p => p.status === 'scheduled' || p.status === 'agendado').length
  const reviewAlerts = data.posts
    .filter(post => ['error', 'erro', 'failed', 'partial'].includes(post.status))
    .map(post => ({ post, diagnosis: failureDiagnosis(post) }))
    .filter(({ diagnosis }) => diagnosis.retryable)
    .slice(0, 4)
  const upcoming = data.posts
    .filter(post => post.status === 'scheduled' || post.status === 'agendado')
    .filter(post => !Number.isNaN(new Date(postDateValue(post)).getTime()))
    .sort((a, b) => new Date(postDateValue(a)) - new Date(postDateValue(b)))
    .slice(0, 4)
  const scheduledWithoutDate = data.posts.filter(post => (post.status === 'scheduled' || post.status === 'agendado') && Number.isNaN(new Date(postDateValue(post)).getTime())).length
  const dashboardError = postsError || accountsError
  const connectedPlatforms = new Set(data.accounts.map(account => account.platform).filter(Boolean)).size
  const analyticsRows = Array.isArray(analytics?.metrics) ? analytics.metrics.filter(row => row.metrics) : []
  const selectedAnalyticsRows = analyticsPlatform === 'all'
    ? analyticsRows
    : analyticsRows.filter(row => row.platform === analyticsPlatform)
  const selectedPlatformLabel = PERFORMANCE_PLATFORM_FILTERS.find(([platform]) => platform === analyticsPlatform)?.[1] || 'Todas as redes'
  // O cartão e o gráfico representam o mesmo recorte: publicações com
  // métricas disponíveis, filtradas pela rede e pelo período selecionados.
  // Totais de conta têm outra semântica (alcance/insights do perfil) e não
  // podem substituir a soma das publicações sem deixar o cartão diferente
  // das barras exibidas logo abaixo.
  const totalViews = selectedAnalyticsRows.reduce((total, row) => total + metricValue(row.metrics, 'views'), 0)
  const totalEngagement = selectedAnalyticsRows.reduce((total, row) => total + engagementValue(row.metrics), 0)
  const engagementRate = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0
  const topEngagementPosts = useMemo(() => [...selectedAnalyticsRows]
    .sort((a, b) => engagementValue(b.metrics) - engagementValue(a.metrics))
    .slice(0, 3), [selectedAnalyticsRows])
  const trend = useMemo(() => {
    const byDay = {}
    selectedAnalyticsRows.forEach(row => {
      const date = new Date(row.publishedAt)
      if (Number.isNaN(date.getTime())) return
      const key = date.toISOString().slice(0, 10)
      byDay[key] = byDay[key] || { views: 0, engagement: 0 }
      byDay[key].views += metricValue(row.metrics, 'views')
      byDay[key].engagement += engagementValue(row.metrics)
    })
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, values]) => ({ date, ...values }))
  }, [selectedAnalyticsRows])
  const bestHour = bestProviderTime(analytics?.accountAnalytics, analyticsPlatform) || bestObservedHour(topEngagementPosts)
  const bestPost = topEngagementPosts[0]
  const maxTrendValue = Math.max(...trend.map(item => Math.max(item.views, item.engagement)), 1)
  const analyticsInsight = bestPost
    ? `O conteúdo com mais interações no recorte gerou ${compactNumber(engagementValue(bestPost.metrics))} interações. Use esse tema ou formato como referência para a próxima criação.`
    : 'Publique e conecte suas contas para que o Dashboard possa transformar desempenho real em recomendações.'
  const timeInsight = bestHour
    ? `Nos conteúdos com mais interação, o horário observado foi ${bestHour}. Teste essa janela em novos posts e compare o resultado.`
    : 'Ainda não há dados suficientes para sugerir um horário de postagem com segurança.'
  const onboardingIncomplete = !accountsLoading && !postsLoading && (data.accounts.length === 0 || data.posts.length === 0 || !data.posts.some(post => ['published', 'publicado', 'scheduled', 'agendado'].includes(post.status)))
  const isEmptyWorkspace = !accountsLoading && !postsLoading && !postsError && !accountsError && data.accounts.length === 0 && data.posts.length === 0
  const recentPosts = useMemo(() => {
    const query = activitySearch.trim().toLowerCase()
    return data.posts
      .filter(post => post.status !== 'cancelled')
      .filter(post => activityFilter === 'all' || (activityFilter === 'published' ? ['published', 'publicado'].includes(post.status) : activityFilter === 'scheduled' ? ['scheduled', 'agendado'].includes(post.status) : ['error', 'erro', 'failed', 'partial'].includes(post.status)))
      .filter(post => !query || (post.text || post.title || '').toLowerCase().includes(query))
      .sort((a, b) => new Date(b.publishedAt || b.scheduledAt || b.scheduled_at || 0) - new Date(a.publishedAt || a.scheduledAt || a.scheduled_at || 0))
      .slice(0, 8)
  }, [data.posts, activityFilter, activitySearch])

  function reviewFailure(post) {
    const selected = Array.isArray(post.platforms) && post.platforms.length ? post.platforms : ['instagram']
    const textByPlatform = post.textByPlatform && typeof post.textByPlatform === 'object'
      ? post.textByPlatform
      : Object.fromEntries(selected.map(platform => [platform, post.text || '']))
    const titleByPlatform = post.titleByPlatform && typeof post.titleByPlatform === 'object' ? post.titleByPlatform : {}
    const mediaItems = Array.isArray(post.mediaItems) ? post.mediaItems : []
    const media = mediaItems[0]
    const mediaPath = media?.path || media?.url || post.mediaPath
    if (mediaPath) {
      sessionStorage.setItem('meu-ecoo:media-library-selection', JSON.stringify({
        url: mediaPath,
        name: media?.name || 'Mídia da publicação',
        mimeType: media?.type || media?.mimetype || post.mediaType || 'application/octet-stream'
      }))
    } else sessionStorage.removeItem('meu-ecoo:media-library-selection')
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({
      text: post.text || '',
      textByPlatform,
      titleByPlatform,
      selected,
      publishNow: true,
      date: '',
      youtubeTitle: post.youtubeTitle || '',
      youtubeVisibility: post.youtubeVisibility || 'public',
      youtubeMadeForKids: post.youtubeMadeForKids == null ? '' : String(post.youtubeMadeForKids),
      youtubeCategoryId: post.youtubeCategoryId || '',
      youtubeFormat: post.youtubeFormat || '',
      igFormat: post.igFormat || 'post',
      tiktokPrivacyLevel: post.tiktokPrivacyLevel || 'PUBLIC_TO_EVERYONE',
      tiktokDisableComment: Boolean(post.tiktokDisableComment),
      tiktokDisableDuet: Boolean(post.tiktokDisableDuet),
      tiktokDisableStitch: Boolean(post.tiktokDisableStitch),
      sourceFailureId: post.id,
      savedAt: new Date().toISOString()
    }))
    onNavigate('agendador')
  }

  function openFailure(post) {
    if (failureDiagnosis(post).retryable) return reviewFailure(post)
    onNavigate('atividade')
  }

  async function deleteFailure(post) {
    const label = post.text || post.title || `Publicação #${post.id}`
    if (!window.confirm(`Excluir esta publicação com falha?\n\n${label}\n\nEla será removida da lista do dashboard e não poderá ser reenviada.`)) return
    setDeletingPostId(post.id)
    try {
      await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' })
      setData(current => ({ ...current, posts: current.posts.filter(item => item.id !== post.id) }))
    } catch (error) {
      setPostsError(error.message)
    } finally {
      setDeletingPostId(null)
    }
  }

  return <section className="page-view dashboard-page">
    <header className="dashboard-hero">
      <div>
        <p className="eyebrow">VISÃO GERAL</p>
        <h2>Seu painel de conteúdo</h2>
        <p>Tenha uma visão rápida das publicações, agendamentos e redes conectadas.</p>
      </div>
      <div className="dashboard-hero-tools">
        <div className="dashboard-live-status"><span className="dashboard-live-dot" aria-hidden="true"/><div><strong>{accountsLoading ? 'Verificando redes' : connectedPlatforms ? 'Operação conectada' : 'Conecte sua primeira rede'}</strong><small>{accountsLoading ? 'Aguarde um instante...' : `${connectedPlatforms} de ${DASHBOARD_PLATFORMS.length} redes com acesso`}</small></div></div>
        <div className="dashboard-actions">
          <button type="button" className="secondary-button dashboard-ai-button" onClick={() => onNavigate('ai')}><span aria-hidden="true">✦</span> Assistente inteligente</button>
          <button type="button" className="secondary-button" onClick={() => onNavigate('integracoes')} aria-label="Adicionar ou gerenciar contas">+ Adicionar conta</button>
          <button type="button" className="secondary-button" onClick={() => onNavigate('calendario')}>Ver calendário</button>
          <button type="button" className="action-button" onClick={() => onNavigate('agendador')}>Criar publicação</button>
        </div>
      </div>
    </header>

    {dashboardError && <p className="dashboard-error-banner" role="alert">{dashboardError}</p>}
    {onboardingIncomplete && <OnboardingChecklist accounts={data.accounts} posts={data.posts} onNavigate={onNavigate} />}

    <section className="panel dashboard-accounts-panel">
      <div className="panel-heading"><div><p className="eyebrow">CONEXÕES</p><h2>Contas e redes</h2><p className="panel-subtitle">{accountsLoading ? 'Verificando conexões...' : `${data.accounts.length} conta${data.accounts.length === 1 ? '' : 's'} conectada${data.accounts.length === 1 ? '' : 's'} em ${connectedPlatforms} de ${DASHBOARD_PLATFORMS.length} redes suportadas.`}</p></div><button type="button" className="action-button dashboard-connect-button" onClick={() => onNavigate('integracoes')}>+ Conectar conta</button></div>
      {accountsLoading
        ? <p className="empty-state" aria-live="polite">Carregando conexões...</p>
      : <div className="dashboard-platform-list">{DASHBOARD_PLATFORMS.map(([platform, label]) => { const platformAccounts = data.accounts.filter(item => item.platform === platform); const account = platformAccounts[0]; const count = platformAccounts.length; return <button type="button" className={`dashboard-platform-card${count ? ' is-connected' : ''}`} key={platform} onClick={() => onNavigate('integracoes')}><span className={`account-platform-icon account-platform-icon-${platform}`}><PlatformIcon platform={platform} className="dashboard-platform-icon" /></span><span className="dashboard-platform-card-copy"><strong>{count > 1 ? `${count} contas ${label}` : account?.name || account?.handle || label}</strong><small>{count ? `${count} conta${count === 1 ? '' : 's'} conectada${count === 1 ? '' : 's'}` : 'Não conectada'}</small></span><span className="dashboard-platform-state" aria-hidden="true">{count ? '✓' : '+'}</span></button> })}</div>}
      {accountsError && <p className="dashboard-inline-error" aria-live="polite">Não foi possível verificar o status das contas.</p>}
    </section>

    {isEmptyWorkspace ? <section className="panel dashboard-empty-state" aria-labelledby="dashboard-empty-title">
      <div className="dashboard-empty-state-icon" aria-hidden="true">＋</div>
      <div>
        <p className="eyebrow">SEU ESPAÇO</p>
        <h2 id="dashboard-empty-title">Seu dashboard ainda está vazio</h2>
        <p>Nenhuma conta, publicação ou métrica aparece aqui até você começar a usar a plataforma.</p>
        <div className="dashboard-empty-state-actions">
          <button type="button" className="action-button" onClick={() => onNavigate('integracoes')}>Conectar primeira conta</button>
          <button type="button" className="secondary-button" onClick={() => onNavigate('agendador')}>Criar primeira publicação</button>
        </div>
      </div>
    </section> : <>
    <div className="metric-grid dashboard-metrics">
      <article className="dashboard-metric-card dashboard-metric-publications"><div className="dashboard-metric-heading"><span>Publicações</span><i aria-hidden="true">✦</i></div><strong>{postsLoading ? '—' : data.posts.length}</strong><small>Total criado na conta</small></article>
      <article className="dashboard-metric-card dashboard-metric-scheduled"><div className="dashboard-metric-heading"><span>Agendadas</span><i aria-hidden="true">◷</i></div><strong>{postsLoading ? '—' : scheduled}</strong><small>{scheduledWithoutDate ? `${scheduledWithoutDate} sem horário definido` : 'Prontas para publicação'}</small></article>
      <article className="dashboard-metric-card dashboard-metric-accounts"><div className="dashboard-metric-heading"><span>Contas conectadas</span><i aria-hidden="true">⌁</i></div><strong>{accountsLoading ? '—' : data.accounts.length}</strong><small>{connectedPlatforms} de {DASHBOARD_PLATFORMS.length} redes ativas</small></article>
    </div>

    {reviewAlerts.length > 0 && <section className="panel dashboard-failures-panel" aria-labelledby="dashboard-failures-title">
      <div className="panel-heading"><div><p className="eyebrow">ATENÇÃO NECESSÁRIA</p><h2 id="dashboard-failures-title">Revisar publicações</h2><p className="panel-subtitle">Alertas de publicações que podem não ter sido concluídas.</p></div><span className="dashboard-failure-count">{reviewAlerts.length} {reviewAlerts.length === 1 ? 'alerta' : 'alertas'}</span></div>
      <div className="dashboard-failures-list">{reviewAlerts.map(({ post, diagnosis }) => { const deleting = deletingPostId === post.id; return <article className="dashboard-failure-item" key={post.id}><div className="dashboard-failure-copy"><p className="dashboard-review-alert">{reviewAlertMessage(post, diagnosis)}</p></div><div className="dashboard-failure-actions"><button type="button" className="link-button" onClick={() => reviewFailure(post)} disabled={deleting}>Revisar publicação</button><button type="button" className="link-button danger-link" onClick={() => deleteFailure(post)} disabled={deleting}>{deleting ? 'Excluindo...' : 'Excluir alerta'}</button></div></article> })}</div>
    </section>}

    <section className="dashboard-insights-grid" aria-label="Métricas e insights do período">
      <section className="panel dashboard-performance-panel">
        <div className="panel-heading"><div><p className="eyebrow">PERFORMANCE</p><h2>Métricas dos últimos {analyticsPeriodDays} dias</h2><p className="panel-subtitle">Dados coletados das publicações com métricas disponíveis nas redes conectadas.</p></div><div className="dashboard-performance-actions"><div className="dashboard-platform-switch" role="group" aria-label="Filtrar performance por rede social">{PERFORMANCE_PLATFORM_FILTERS.map(([platform, label]) => <button type="button" className={analyticsPlatform === platform ? 'is-active' : ''} aria-pressed={analyticsPlatform === platform} key={platform} onClick={() => setAnalyticsPlatform(platform)}>{platform !== 'all' && <PlatformIcon platform={platform} className="dashboard-platform-filter-icon" />}{label}</button>)}</div><div className="dashboard-period-switch" role="group" aria-label="Período da performance">{PERFORMANCE_PERIODS.map(days => <button type="button" className={analyticsPeriodDays === days ? 'is-active' : ''} aria-pressed={analyticsPeriodDays === days} key={days} onClick={() => setAnalyticsPeriodDays(days)}>{days} dias</button>)}</div><button type="button" className="link-button" onClick={() => onNavigate('analytics')}>Ver análises completas</button></div></div>
         {analyticsLoading && !analytics
           ? <p className="empty-state" aria-live="polite">Carregando métricas...</p>
           : analyticsError && !analytics
             ? <div className="dashboard-analytics-empty"><strong>Métricas indisponíveis no momento</strong><p>{analyticsError}</p><button type="button" className="link-button" onClick={() => onNavigate('analytics')}>Abrir Analytics</button></div>
             : <>
                 {analyticsError && <div className="dashboard-analytics-warning" role="status"><span>Não foi possível atualizar agora. Exibindo o último resultado válido.</span><button type="button" className="link-button" onClick={() => setAnalyticsRetry(value => value + 1)}>Tentar novamente</button></div>}
                 <div className="dashboard-kpi-row"><div><span>Visualizações</span><strong>{compactNumber(totalViews)}</strong></div><div><span>Interações</span><strong>{compactNumber(totalEngagement)}</strong></div><div><span>Taxa de interação</span><strong>{engagementRate.toFixed(1)}%</strong></div></div>
                  <div className="dashboard-trend-chart" role="img" aria-label={`Gráfico de visualizações e interações de ${selectedPlatformLabel.toLowerCase()} dos últimos ${analyticsPeriodDays} dias`}>
                  {trend.length ? trend.map(item => <div className="dashboard-chart-column" key={item.date}><div className="dashboard-chart-bars"><span className="dashboard-chart-bar is-views" style={{ height: `${Math.max((item.views / maxTrendValue) * 100, item.views ? 8 : 2)}%` }} title={`${compactNumber(item.views)} visualizações`}/><span className="dashboard-chart-bar is-engagement" style={{ height: `${Math.max((item.engagement / maxTrendValue) * 100, item.engagement ? 8 : 2)}%` }} title={`${compactNumber(item.engagement)} interações`}/></div><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</small></div>) : <p className="empty-state">Ainda não há série suficiente para desenhar o gráfico.</p>}
                </div>
                <div className="dashboard-chart-legend"><span><i className="is-views"/>Visualizações</span><span><i className="is-engagement"/>Interações</span></div>
              </>}
      </section>

      <section className="panel dashboard-ai-insights-panel">
        <div className="panel-heading"><div><p className="eyebrow">INSIGHTS PARA AÇÃO</p><h2>O que fazer agora</h2><p className="panel-subtitle">Leituras simples para transformar dados em próximos testes.</p></div><span className="dashboard-insight-spark" aria-hidden="true">✦</span></div>
        <article className="dashboard-insight-card"><span className="dashboard-insight-icon">↗</span><div><strong>Conteúdo</strong><p>{analyticsInsight}</p></div></article>
        <article className="dashboard-insight-card"><span className="dashboard-insight-icon">◷</span><div><strong>Horário de postagem</strong><p>{timeInsight}</p></div></article>
        <article className="dashboard-insight-card is-action"><span className="dashboard-insight-icon">✦</span><div><strong>Próximo teste</strong><p>Crie uma variação com o sistema inteligente usando a publicação de melhor desempenho como referência.</p><button type="button" className="link-button" onClick={() => onNavigate('ai')}>Criar uma variação</button></div></article>
      </section>
    </section>

    {topEngagementPosts.length > 0 && <section className="panel dashboard-top-posts-panel" aria-labelledby="dashboard-top-posts-title">
      <div className="panel-heading"><div><p className="eyebrow">DESTAQUES</p><h2 id="dashboard-top-posts-title">Publicações com maior engajamento</h2><p className="panel-subtitle">O ranking considera curtidas, comentários, compartilhamentos e salvamentos registrados.</p></div><button type="button" className="link-button" onClick={() => onNavigate('analytics')}>Comparar no Analytics</button></div>
      <div className="dashboard-top-posts-list">{topEngagementPosts.map((post, index) => <article className="dashboard-top-post" key={`${post.postId}-${post.platform}`}><span className="dashboard-top-post-rank">0{index + 1}</span><span className={`account-platform-icon account-platform-icon-${post.platform}`}><PlatformIcon platform={post.platform} className="h-4 w-4" /></span><div className="dashboard-top-post-copy"><strong>{post.text || post.youtubeTitle || 'Publicação sem descrição'}</strong><small>{post.platform} · {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('pt-BR') : 'Data não informada'}</small></div><div className="dashboard-top-post-metric"><strong>{compactNumber(engagementValue(post.metrics))}</strong><small>interações</small></div></article>)}</div>
    </section>}

    <div className="dashboard-grid">
      <section className="panel">
       <div className="panel-heading">
         <div><p className="eyebrow">ATIVIDADE</p><h2>Publicações recentes</h2><p className="panel-subtitle">Acompanhe o que foi publicado e o que está em andamento.</p></div><button type="button" className="link-button" onClick={() => onNavigate('atividade')}>Ver histórico</button>
       </div>
      <div className="dashboard-activity-toolbar"><input value={activitySearch} onChange={event => setActivitySearch(event.target.value)} placeholder="Buscar publicação..." aria-label="Buscar publicação no dashboard"/><div className="dashboard-filter-buttons" role="group" aria-label="Filtrar publicações"><button type="button" className={activityFilter === 'all' ? 'active' : ''} onClick={() => setActivityFilter('all')}>Todas</button><button type="button" className={activityFilter === 'published' ? 'active' : ''} onClick={() => setActivityFilter('published')}>Publicadas</button><button type="button" className={activityFilter === 'scheduled' ? 'active' : ''} onClick={() => setActivityFilter('scheduled')}>Agendadas</button><button type="button" className={activityFilter === 'failed' ? 'active' : ''} onClick={() => setActivityFilter('failed')}>Falhas</button></div></div>
      {postsError
        ? <p className="error-message" aria-live="polite">Não foi possível carregar as publicações.</p>
        : postsLoading
          ? <p className="empty-state" aria-live="polite">Carregando publicações...</p>
          : recentPosts.length
            ? <div className="data-list">{recentPosts.map(post => { const isFailure = ['failed', 'error', 'erro', 'partial'].includes(post.status); const canRetry = isFailure && failureDiagnosis(post).retryable; return <div className="data-row dashboard-post-row" key={post.id}><span className="dashboard-post-platforms" aria-label={postPlatforms(post).length ? postPlatforms(post).join(', ') : 'Rede não informada'}>{postPlatforms(post).length ? postPlatforms(post).map(platform => <span className={`account-platform-icon account-platform-icon-${platform}`} key={platform}><PlatformIcon platform={platform} className="h-3.5 w-3.5" /></span>) : <span className="dashboard-platform-missing">◎</span>}</span><span className="dashboard-post-copy"><strong>{post.text || post.title || 'Publicação sem texto'}</strong><small>{formatPostDate(postDateValue(post))}</small></span><span className={`status-text status-text-${post.status || 'unknown'}`}>{STATUS_LABELS[post.status] || post.status || 'Sem status'}</span><button type="button" className="link-button dashboard-post-action" onClick={() => post.status === 'scheduled' || post.status === 'agendado' ? onNavigate('calendario') : isFailure ? openFailure(post) : onNavigate('atividade')}>{post.status === 'scheduled' || post.status === 'agendado' ? 'Calendário' : isFailure ? (canRetry ? 'Revisar no editor' : 'Ver detalhes') : 'Detalhes'}</button></div> })}</div>
            : <p className="empty-state">{activitySearch || activityFilter !== 'all' ? 'Nenhuma publicação encontrada para este filtro.' : 'Nenhuma publicação encontrada.'}</p>}
      </section>

      <section className="panel dashboard-upcoming-panel">
        <div className="panel-heading"><div><p className="eyebrow">PRÓXIMOS PASSOS</p><h2>Próximos agendamentos</h2></div><button type="button" className="link-button" onClick={() => onNavigate('calendario')}>Ver calendário</button></div>
        {postsLoading
          ? <p className="empty-state" aria-live="polite">Carregando agenda...</p>
          : upcoming.length
            ? <div className="dashboard-upcoming-list">{upcoming.map(post => <div className="dashboard-upcoming-item" key={post.id}><span className="dashboard-upcoming-date">{formatPostDate(postDateValue(post))}</span><strong>{post.text || post.title || 'Publicação sem texto'}</strong><button type="button" className="link-button" onClick={() => onNavigate('calendario')}>Abrir calendário</button></div>)}</div>
            : scheduledWithoutDate
              ? <div className="dashboard-callout dashboard-callout-warning"><span className="dashboard-callout-icon" aria-hidden="true">!</span><p>{scheduledWithoutDate === 1 ? '1 publicação agendada está' : `${scheduledWithoutDate} publicações agendadas estão`} sem horário definido.</p><button type="button" className="link-button" onClick={() => onNavigate('calendario')}>Corrigir agenda</button></div>
              : <div className="dashboard-callout"><span className="dashboard-callout-icon" aria-hidden="true">✦</span><p>Nenhum agendamento próximo. Crie uma publicação para manter suas redes ativas.</p><button type="button" className="link-button" onClick={() => onNavigate('agendador')}>Agendar agora</button></div>}
      </section>
    </div>

    </>}

  </section>
}
