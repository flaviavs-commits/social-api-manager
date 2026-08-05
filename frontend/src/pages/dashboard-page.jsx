import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { PlatformIcon } from '../components/ui/platform-icon.jsx'
import { OnboardingChecklist } from '../components/ui/onboarding-checklist.jsx'

const STATUS_LABELS = { scheduled: 'Agendada', agendado: 'Agendada', published: 'Publicada', publicado: 'Publicado', failed: 'Falhou', erro: 'Falhou', error: 'Falhou', partial: 'Parcial', processing: 'Processando' }
const SCHEDULER_AUTOSAVE_KEY = 'meu-ecoo:scheduler-autosave'
const ACTIVITY_FILTER_KEY = 'meu-ecoo:dashboard-activity-filter'
const DASHBOARD_PLATFORMS = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']]

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

export function DashboardPage({ onNavigate }) {
  const [data, setData] = useState({ posts: [], accounts: [] })
  const [postsError, setPostsError] = useState('')
  const [accountsError, setAccountsError] = useState('')
  const [postsLoading, setPostsLoading] = useState(true)
  const [accountsLoading, setAccountsLoading] = useState(true)
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
      <article><span>Contas conectadas</span><strong>{accountsLoading ? '—' : data.accounts.length}</strong><small>Redes disponíveis</small></article>
    </div>

    {failures.length > 0 && <section className="panel dashboard-failures-panel" aria-labelledby="dashboard-failures-title">
      <div className="panel-heading"><div><p className="eyebrow">ATENÇÃO NECESSÁRIA</p><h2 id="dashboard-failures-title">Publicações que precisam de revisão</h2><p className="panel-subtitle">Confira o motivo da falha e envie novamente depois de corrigir o problema.</p></div><span className="dashboard-failure-count">{failedCount} {failedCount === 1 ? 'falha' : 'falhas'}</span></div>
      <div className="dashboard-failures-list">{failures.map(post => <article className="dashboard-failure-item" key={post.id}><div><strong>{post.text || post.title || `Publicação #${post.id}`}</strong><p>{post.errorMessage || 'A publicação não foi concluída em todas as redes.'}</p>{post.retryCount > 0 && <small>{post.retryCount} tentativa{post.retryCount > 1 ? 's' : ''} automática{post.retryCount > 1 ? 's' : ''}</small>}</div><button className="link-button" onClick={() => reviewFailure(post)}>Revisar no editor</button></article>)}</div>
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
      <div className="panel-heading"><div><p className="eyebrow">CONEXÕES</p><h2>Redes conectadas</h2></div><button className="link-button" onClick={() => onNavigate('integracoes')}>Gerenciar contas</button></div>
      {accountsLoading
        ? <p className="empty-state" aria-live="polite">Carregando conexões...</p>
        : <div className="dashboard-platform-list">{DASHBOARD_PLATFORMS.map(([platform, label]) => { const account = data.accounts.find(item => item.platform === platform); return <button type="button" className={`dashboard-platform-card${account ? ' is-connected' : ''}`} key={platform} onClick={() => onNavigate('integracoes')}><span className={`account-platform-icon account-platform-icon-${platform}`}><PlatformIcon platform={platform} className="h-4 w-4" /></span><span><strong>{account?.name || account?.handle || label}</strong><small>{account ? 'Conectada' : 'Não conectada'}</small></span><span className="dashboard-platform-state" aria-hidden="true">{account ? '✓' : '+'}</span></button> })}</div>}
      {accountsError && <p className="dashboard-inline-error" aria-live="polite">Não foi possível verificar o status das contas.</p>}
    </section>

  </section>
}
