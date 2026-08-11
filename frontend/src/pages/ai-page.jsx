import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { SchedSection } from '../components/ui/sched-section.jsx'
import { AiModelPicker } from '../components/ai/ai-model-picker.jsx'

// O backend espera até 45s pelo provedor. O OpenRouter pode precisar de alguns
// segundos adicionais para devolver a resposta ou o fallback do servidor.
const AI_GENERATION_TIMEOUT_MS = 60_000

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

  useEffect(() => {
    apiFetch('/api/ai/activity-log?limit=20')
      .then(data => setActivityLogs(data.logs || []))
      .catch(() => {})
  }, [])

  async function generate(event) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const data = await apiFetch('/api/ai/generate', { method: 'POST', timeoutMs: AI_GENERATION_TIMEOUT_MS, body: JSON.stringify({ instrucao: instruction, plataformas: ['instagram'], quantidade: 3, tom: 'profissional', modelo }) })
      setPosts((data.posts || []).map(post => ({ ...post, text: post.texto || post.text || post.caption || '' })))
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
      const novos = (data.posts || []).map(post => ({ ...post, text: post.texto || post.text || post.caption || '' }))
      setPosts(current => [...current, ...novos])
    } catch (e) { setError(e.message) } finally { setLoadingMore(false) }
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

  return <section className={`page-view ai-page${posts.length ? ' has-results' : ' is-empty'}`}><header className="ai-page-intro"><div><p className="eyebrow">ASSISTENTE IA</p><h2>Crie conteúdo com mais agilidade</h2><p>Descreva o que você quer publicar e receba ideias prontas para revisar, adaptar e usar nas suas redes.</p></div><span className="ai-page-intro-badge"><span aria-hidden="true">✦</span> Seu copiloto de conteúdo</span></header><section className="panel ai-generator-panel">
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
    <div className="ai-panel-heading"><div><p className="eyebrow">RESULTADOS</p><h2>Sugestões para você</h2><p>Revise o texto e escolha a ideia que melhor combina com sua estratégia.</p></div><span className="ai-result-count">{posts.length} ideias</span></div>
    <div className="ai-suggestion-list">{posts.map((post, index) => <article className="ai-suggestion-card" key={post.id || index}><span className="ai-suggestion-number">{String(index + 1).padStart(2, '0')}</span><div className="ai-suggestion-body">
      {editingIndex === index
        ? <textarea className="ai-suggestion-editor" value={post.text} onChange={event => setPosts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} aria-label={`Editar sugestão ${index + 1}`} />
        : <p>{post.text}</p>}
      <button type="button" className="ai-edit-button link-button" onClick={() => setEditingIndex(editingIndex === index ? null : index)}>{editingIndex === index ? 'Concluir edição' : 'Editar texto'}</button>
    </div></article>)}</div>
    <button type="button" className="action-button ai-generate-more-button" onClick={generateMore} disabled={loadingMore || loading}>{loadingMore ? 'Gerando mais ideias...' : 'Gerar mais ideias sobre este assunto'}</button>
  </section>}
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
