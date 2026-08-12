import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { OnboardingChecklist } from '../components/ui/onboarding-checklist.jsx'

const STATUS_LABELS = { scheduled: 'Agendada', agendado: 'Agendada', published: 'Publicada', publicado: 'Publicado', failed: 'Falhou', erro: 'Falhou', error: 'Falhou', partial: 'Parcial', processing: 'Processando' }
const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const ACTIVITY_FILTER_KEY = 'meu-ecoo:dashboard-activity-filter'
const DASHBOARD_PLATFORMS = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']]
const ANALYTICS_PERIOD_DAYS = 30

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
  if (/exception|stack|cannot read|undefined|internal|database|sql|500|programa/.test(normalized)) {
    return {
      label: 'Possível falha do sistema',
      className: 'is-system',
      reason: message || 'O processamento interno não conseguiu concluir a publicação.',
      nextStep: 'Envie novamente. Se persistir sem alteração no conteúdo ou na conexão, abra um chamado com este diagnóstico.'
    }
  }
  if (/token|autoriz|permiss|access|401|403|429|rate.?limit|instagram|facebook|youtube|tiktok|api|timeout|conex|network|fetch/.test(normalized)) {
    return {
      label: 'Rede social ou conexão',
      className: 'is-network',
      reason: message || 'A rede social ou a conexão não confirmou a publicação.',
      nextStep: 'Verifique a conexão da conta e reconecte a rede se o acesso tiver expirado.'
    }
  }
  if (/imagem|image|vídeo|video|mídia|media|formato|tamanho|caract|caption|texto|obrigat|conteúdo|content/.test(normalized)) {
    return {
      label: 'Conteúdo ou configuração',
      className: 'is-content',
      reason: message || 'O conteúdo ou alguma configuração não atende aos requisitos da rede.',
      nextStep: 'Revise mídia, texto e configurações específicas da plataforma antes de publicar novamente.'
    }
  }
  return {
    label: 'Origem não conclusiva',
    className: 'is-unknown',
    reason: message || 'A publicação foi marcada como falha, mas não há detalhes suficientes no registro.',
    nextStep: 'Tente publicar novamente. Se a falha se repetir, o registro detalhado ajudará a identificar a origem.'
  }
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

function bestProviderTime(accountAnalytics) {
  const slots = (accountAnalytics?.bestTimeToPost || []).flatMap(item => item.data?.slots || [])
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
  const [analyticsError, setAnalyticsError] = useState('')
  const [postsLoading, setPostsLoading] = useState(true)
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [activityFilter, setActivityFilter] = useState(() => localStorage.getItem(ACTIVITY_FILTER_KEY) || 'all')
  const [activitySearch, setActivitySearch] = useState('')

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
    apiFetch(`/api/posts/analytics?days=${ANALYTICS_PERIOD_DAYS}`)
      .then(result => { if (active) { setAnalytics(result); setAnalyticsError('') } })
      .catch(error => { if (active) setAnalyticsError(error.message) })
      .finally(() => { if (active) setAnalyticsLoading(false) })
    return () => { active = false }
  }, [])

  const scheduled = data.posts.filter(p => p.status === 'scheduled' || p.status === 'agendado').length
  const failedCount = data.posts.filter(post => ['error', 'erro', 'failed', 'partial'].includes(post.status)).length
  const failures = data.posts.filter(post => ['error', 'erro', 'failed', 'partial'].includes(post.status)).slice(0, 4)
  const upcoming = data.posts
    .filter(post => post.status === 'scheduled' || post.status === 'agendado')
    .filter(post => !Number.isNaN(new Date(postDateValue(post)).getTime()))
    .sort((a, b) => new Date(postDateValue(a)) - new Date(postDateValue(b)))
    .slice(0, 4)
  const scheduledWithoutDate = data.posts.filter(post => (post.status === 'scheduled' || post.status === 'agendado') && Number.isNaN(new Date(postDateValue(post)).getTime())).length
  const dashboardError = postsError || accountsError
  const connectedPlatforms = new Set(data.accounts.map(account => account.platform).filter(Boolean)).size
  const analyticsRows = Array.isArray(analytics?.metrics) ? analytics.metrics.filter(row => row.metrics) : []
  const totalViews = analyticsRows.reduce((total, row) => total + metricValue(row.metrics, 'views'), 0)
  const totalEngagement = analyticsRows.reduce((total, row) => total + engagementValue(row.metrics), 0)
  const engagementRate = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0
  const topEngagementPosts = useMemo(() => [...analyticsRows]
    .sort((a, b) => engagementValue(b.metrics) - engagementValue(a.metrics))
    .slice(0, 3), [analyticsRows])
  const trend = useMemo(() => {
    const byDay = {}
    analyticsRows.forEach(row => {
      const date = new Date(row.publishedAt)
      if (Number.isNaN(date.getTime())) return
      const key = date.toISOString().slice(0, 10)
      byDay[key] = byDay[key] || { views: 0, engagement: 0 }
      byDay[key].views += metricValue(row.metrics, 'views')
      byDay[key].engagement += engagementValue(row.metrics)
    })
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, values]) => ({ date, ...values }))
  }, [analyticsRows])
  const bestHour = bestProviderTime(analytics?.accountAnalytics) || bestObservedHour(topEngagementPosts)
  const bestPost = topEngagementPosts[0]
  const maxTrendValue = Math.max(...trend.map(item => Math.max(item.views, item.engagement)), 1)
  const analyticsInsight = bestPost
    ? `O conteúdo com mais interações no recorte gerou ${compactNumber(engagementValue(bestPost.metrics))} interações. Use esse tema ou formato como referência para a próxima criação.`
    : 'Publique e conecte suas contas para que o Dashboard possa transformar desempenho real em recomendações.'
  const timeInsight = bestHour
    ? `Nos conteúdos com mais interação, o horário observado foi ${bestHour}. Teste essa janela em novos posts e compare o resultado.`
    : 'Ainda não há dados suficientes para sugerir um horário de postagem com segurança.'
  const onboardingIncomplete = !accountsLoading && !postsLoading && (data.accounts.length === 0 || data.posts.length === 0 || !data.posts.some(post => ['published', 'publicado', 'scheduled', 'agendado'].includes(post.status)))
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
    localStorage.setItem(SCHEDULER_AUTOSAVE_KEY, JSON.stringify({ text: post.text || '', selected, publishNow: false, date: '', savedAt: new Date().toISOString() }))
    onNavigate('agendador')
  }

  return <section className="page-view dashboard-page">
    <header className="dashboard-hero">
      <div>
        <p className="eyebrow">VISÃO GERAL</p>
        <h2>Seu painel de conteúdo</h2>
        <p>Tenha uma visão rápida das publicações, agendamentos e redes conectadas.</p>
      </div>
      <div className="dashboard-actions">
        <button className="secondary-button" onClick={() => onNavigate('integracoes')} aria-label="Adicionar ou gerenciar contas">+ Adicionar conta</button>
        <button className="secondary-button" onClick={() => onNavigate('calendario')}>Ver calendário</button>
        <button className="action-button" onClick={() => onNavigate('agendador')}>Criar publicação</button>
      </div>
    </header>

    {dashboardError && <p className="dashboard-error-banner" role="alert">{dashboardError}</p>}
    {onboardingIncomplete && <OnboardingChecklist accounts={data.accounts} posts={data.posts} onNavigate={onNavigate} />}

    <div className="metric-grid dashboard-metrics">
      <article><span>Publicações</span><strong>{postsLoading ? '—' : data.posts.length}</strong><small>Total criado na conta</small></article>
      <article><span>Agendadas</span><strong>{postsLoading ? '—' : scheduled}</strong><small>{scheduledWithoutDate ? `${scheduledWithoutDate} sem horário definido` : 'Prontas para publicação'}</small></article>
      <article><span>Falhas</span><strong className={failedCount ? 'metric-warning' : ''}>{postsLoading ? '—' : failedCount}</strong><small>{failedCount ? 'Precisam de revisão' : 'Nenhuma pendência'}</small></article>
      <article><span>Contas conectadas</span><strong>{accountsLoading ? '—' : data.accounts.length}</strong><small>{connectedPlatforms} de {DASHBOARD_PLATFORMS.length} redes ativas</small></article>
    </div>

    {failures.length > 0 && <section className="panel dashboard-failures-panel" aria-labelledby="dashboard-failures-title">
      <div className="panel-heading"><div><p className="eyebrow">ATENÇÃO NECESSÁRIA</p><h2 id="dashboard-failures-title">Publicações que precisam de revisão</h2><p className="panel-subtitle">Cada falha mostra sua origem provável para não atribuir automaticamente o problema ao programa.</p></div><span className="dashboard-failure-count">{failedCount} {failedCount === 1 ? 'falha' : 'falhas'}</span></div>
      <div className="dashboard-failure-explainer"><strong>Como interpretar:</strong> falha do sistema só é indicada quando o registro aponta erro interno. Token, limite, permissão e formato são responsabilidade da conexão, da rede ou da configuração do conteúdo.</div>
      <div className="dashboard-failures-list">{failures.map(post => { const diagnosis = failureDiagnosis(post); return <article className="dashboard-failure-item" key={post.id}><div className="dashboard-failure-copy"><div className="dashboard-failure-title-row"><strong>{post.text || post.title || `Publicação #${post.id}`}</strong><span className={`dashboard-failure-origin ${diagnosis.className}`}>{diagnosis.label}</span></div><p><b>O que aconteceu:</b> {diagnosis.reason}</p><small><b>Próximo passo:</b> {diagnosis.nextStep}</small>{post.retryCount > 0 && <small>{post.retryCount} tentativa{post.retryCount > 1 ? 's' : ''} automática{post.retryCount > 1 ? 's' : ''}</small>}</div><button className="link-button" onClick={() => reviewFailure(post)}>Revisar no editor</button></article> })}</div>
    </section>}

    <section className="dashboard-insights-grid" aria-label="Métricas e insights do período">
      <section className="panel dashboard-performance-panel">
        <div className="panel-heading"><div><p className="eyebrow">PERFORMANCE</p><h2>Métricas dos últimos {ANALYTICS_PERIOD_DAYS} dias</h2><p className="panel-subtitle">Dados coletados das publicações com métricas disponíveis nas redes conectadas.</p></div><button type="button" className="link-button" onClick={() => onNavigate('analytics')}>Ver análises completas</button></div>
        {analyticsLoading
          ? <p className="empty-state" aria-live="polite">Carregando métricas...</p>
          : analyticsError
            ? <div className="dashboard-analytics-empty"><strong>Métricas indisponíveis no momento</strong><p>{analyticsError}</p><button type="button" className="link-button" onClick={() => onNavigate('analytics')}>Abrir Analytics</button></div>
            : <>
                <div className="dashboard-kpi-row"><div><span>Visualizações</span><strong>{compactNumber(totalViews)}</strong></div><div><span>Interações</span><strong>{compactNumber(totalEngagement)}</strong></div><div><span>Taxa de interação</span><strong>{engagementRate.toFixed(1)}%</strong></div></div>
                <div className="dashboard-trend-chart" role="img" aria-label="Gráfico de visualizações e interações dos últimos dias">
                  {trend.length ? trend.map(item => <div className="dashboard-chart-column" key={item.date}><div className="dashboard-chart-bars"><span className="dashboard-chart-bar is-views" style={{ height: `${Math.max((item.views / maxTrendValue) * 100, item.views ? 8 : 2)}%` }} title={`${compactNumber(item.views)} visualizações`}/><span className="dashboard-chart-bar is-engagement" style={{ height: `${Math.max((item.engagement / maxTrendValue) * 100, item.engagement ? 8 : 2)}%` }} title={`${compactNumber(item.engagement)} interações`}/></div><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</small></div>) : <p className="empty-state">Ainda não há série suficiente para desenhar o gráfico.</p>}
                </div>
                <div className="dashboard-chart-legend"><span><i className="is-views"/>Visualizações</span><span><i className="is-engagement"/>Interações</span></div>
              </>}
      </section>

      <section className="panel dashboard-ai-insights-panel">
        <div className="panel-heading"><div><p className="eyebrow">INSIGHTS PARA AÇÃO</p><h2>O que fazer agora</h2><p className="panel-subtitle">Leituras simples para transformar dados em próximos testes.</p></div><span className="dashboard-insight-spark" aria-hidden="true">✦</span></div>
        <article className="dashboard-insight-card"><span className="dashboard-insight-icon">↗</span><div><strong>Conteúdo</strong><p>{analyticsInsight}</p></div></article>
        <article className="dashboard-insight-card"><span className="dashboard-insight-icon">◷</span><div><strong>Horário de postagem</strong><p>{timeInsight}</p></div></article>
        <article className="dashboard-insight-card is-action"><span className="dashboard-insight-icon">✦</span><div><strong>Próximo teste</strong><p>Crie uma variação com a IA usando a publicação de melhor desempenho como referência.</p><button type="button" className="link-button" onClick={() => onNavigate('ai')}>Criar com IA</button></div></article>
      </section>
    </section>

    {topEngagementPosts.length > 0 && <section className="panel dashboard-top-posts-panel" aria-labelledby="dashboard-top-posts-title">
      <div className="panel-heading"><div><p className="eyebrow">DESTAQUES</p><h2 id="dashboard-top-posts-title">Publicações com maior engajamento</h2><p className="panel-subtitle">O ranking considera curtidas, comentários, compartilhamentos e salvamentos registrados.</p></div><button type="button" className="link-button" onClick={() => onNavigate('analytics')}>Comparar no Analytics</button></div>
      <div className="dashboard-top-posts-list">{topEngagementPosts.map((post, index) => <article className="dashboard-top-post" key={`${post.postId}-${post.platform}`}><span className="dashboard-top-post-rank">0{index + 1}</span><span className={`account-platform-icon account-platform-icon-${post.platform}`}><PlatformIcon platform={post.platform} className="h-4 w-4" /></span><div className="dashboard-top-post-copy"><strong>{post.text || post.youtubeTitle || 'Publicação sem descrição'}</strong><small>{post.platform} · {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('pt-BR') : 'Data não informada'}</small></div><div className="dashboard-top-post-metric"><strong>{compactNumber(engagementValue(post.metrics))}</strong><small>interações</small></div></article>)}</div>
    </section>}

    <div className="dashboard-grid">
      <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">ATIVIDADE</p><h2>Publicações recentes</h2><p className="panel-subtitle">Acompanhe o que foi publicado e o que está em andamento.</p></div>
      </div>
      <div className="dashboard-activity-toolbar"><input value={activitySearch} onChange={event => setActivitySearch(event.target.value)} placeholder="Buscar publicação..." aria-label="Buscar publicação no dashboard"/><div className="dashboard-filter-buttons" role="group" aria-label="Filtrar publicações"><button type="button" className={activityFilter === 'all' ? 'active' : ''} onClick={() => setActivityFilter('all')}>Todas</button><button type="button" className={activityFilter === 'published' ? 'active' : ''} onClick={() => setActivityFilter('published')}>Publicadas</button><button type="button" className={activityFilter === 'scheduled' ? 'active' : ''} onClick={() => setActivityFilter('scheduled')}>Agendadas</button><button type="button" className={activityFilter === 'failed' ? 'active' : ''} onClick={() => setActivityFilter('failed')}>Falhas</button></div></div>
      {postsError
        ? <p className="error-message" aria-live="polite">Não foi possível carregar as publicações.</p>
        : postsLoading
          ? <p className="empty-state" aria-live="polite">Carregando publicações...</p>
          : recentPosts.length
            ? <div className="data-list">{recentPosts.map(post => <div className="data-row dashboard-post-row" key={post.id}><span className="dashboard-post-platforms" aria-label={postPlatforms(post).length ? postPlatforms(post).join(', ') : 'Rede não informada'}>{postPlatforms(post).length ? postPlatforms(post).map(platform => <span className={`account-platform-icon account-platform-icon-${platform}`} key={platform}><PlatformIcon platform={platform} className="h-3.5 w-3.5" /></span>) : <span className="dashboard-platform-missing">◎</span>}</span><span className="dashboard-post-copy"><strong>{post.text || post.title || 'Publicação sem texto'}</strong><small>{formatPostDate(postDateValue(post))}</small></span><span className={`status-text status-text-${post.status || 'unknown'}`}>{STATUS_LABELS[post.status] || post.status || 'Sem status'}</span><button type="button" className="link-button dashboard-post-action" onClick={() => post.status === 'scheduled' || post.status === 'agendado' ? onNavigate('calendario') : post.status === 'failed' || post.status === 'error' || post.status === 'erro' || post.status === 'partial' ? reviewFailure(post) : onNavigate('atividade')}>{post.status === 'scheduled' || post.status === 'agendado' ? 'Calendário' : post.status === 'failed' || post.status === 'error' || post.status === 'erro' || post.status === 'partial' ? 'Revisar' : 'Detalhes'}</button></div>)}</div>
            : <p className="empty-state">{activitySearch || activityFilter !== 'all' ? 'Nenhuma publicação encontrada para este filtro.' : 'Nenhuma publicação encontrada.'}</p>}
      </section>

      <section className="panel dashboard-upcoming-panel">
        <div className="panel-heading"><div><p className="eyebrow">PRÓXIMOS PASSOS</p><h2>Próximos agendamentos</h2></div><button className="link-button" onClick={() => onNavigate('calendario')}>Ver calendário</button></div>
        {postsLoading
          ? <p className="empty-state" aria-live="polite">Carregando agenda...</p>
          : upcoming.length
            ? <div className="dashboard-upcoming-list">{upcoming.map(post => <div className="dashboard-upcoming-item" key={post.id}><span className="dashboard-upcoming-date">{formatPostDate(postDateValue(post))}</span><strong>{post.text || post.title || 'Publicação sem texto'}</strong><button type="button" className="link-button" onClick={() => onNavigate('calendario')}>Abrir calendário</button></div>)}</div>
            : scheduledWithoutDate
              ? <div className="dashboard-callout dashboard-callout-warning"><span className="dashboard-callout-icon" aria-hidden="true">!</span><p>{scheduledWithoutDate === 1 ? '1 publicação agendada está' : `${scheduledWithoutDate} publicações agendadas estão`} sem horário definido.</p><button className="link-button" onClick={() => onNavigate('calendario')}>Corrigir agenda</button></div>
              : <div className="dashboard-callout"><span className="dashboard-callout-icon" aria-hidden="true">✦</span><p>Nenhum agendamento próximo. Crie uma publicação para manter suas redes ativas.</p><button className="link-button" onClick={() => onNavigate('agendador')}>Agendar agora</button></div>}
      </section>
    </div>

    <section className="panel dashboard-accounts-panel">
      <div className="panel-heading"><div><p className="eyebrow">CONEXÕES</p><h2>Contas e redes</h2><p className="panel-subtitle">{accountsLoading ? 'Verificando conexões...' : `${data.accounts.length} conta${data.accounts.length === 1 ? '' : 's'} conectada${data.accounts.length === 1 ? '' : 's'} em ${connectedPlatforms} de ${DASHBOARD_PLATFORMS.length} redes suportadas.`}</p></div><button className="action-button dashboard-connect-button" onClick={() => onNavigate('integracoes')}>+ Conectar conta</button></div>
      {accountsLoading
        ? <p className="empty-state" aria-live="polite">Carregando conexões...</p>
        : <div className="dashboard-platform-list">{DASHBOARD_PLATFORMS.map(([platform, label]) => { const platformAccounts = data.accounts.filter(item => item.platform === platform); const account = platformAccounts[0]; const count = platformAccounts.length; return <button type="button" className={`dashboard-platform-card${count ? ' is-connected' : ''}`} key={platform} onClick={() => onNavigate('integracoes')}><span className={`account-platform-icon account-platform-icon-${platform}`}><PlatformIcon platform={platform} className="h-4 w-4" /></span><span><strong>{count > 1 ? `${count} contas ${label}` : account?.name || account?.handle || label}</strong><small>{count ? `${count} conta${count === 1 ? '' : 's'} conectada${count === 1 ? '' : 's'}` : 'Não conectada'}</small></span><span className="dashboard-platform-state" aria-hidden="true">{count ? '✓' : '+'}</span></button> })}</div>}
      {accountsError && <p className="dashboard-inline-error" aria-live="polite">Não foi possível verificar o status das contas.</p>}
    </section>

  </section>
}
