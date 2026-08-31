import { filterByPeriod, filterTikTokVideosByPeriod, fmtNum, NETWORK_ORDER, PLAT_COLORS, PLAT_LABELS } from '../../lib/analytics-format.js'
import { PlatformIcon } from '../ui/platform-icon.jsx'

function metricNumber(metrics, name) {
  const value = metrics?.[name]
  const normalized = value && typeof value === 'object' ? value.total : value
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function sumNullable(rows, name) {
  const values = rows.map(row => metricNumber(row.metrics, name)).filter(value => value != null)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function profileMetricSum(profiles, names) {
  const values = profiles.flatMap(profile => names.map(name => metricNumber(profile.totals?.metrics, name)).filter(value => value != null))
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function profileMetricFirst(profiles, names) {
  const values = profiles.map(profile => names.map(name => metricNumber(profile.totals?.metrics, name)).find(value => value != null)).filter(value => value != null)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function audienceStats(data, platform) {
  const accounts = (data.accountAnalytics?.followerStats?.accounts || []).filter(item => item.platform === platform)
  if (accounts.length) {
    const current = accounts.map(item => Number(item.currentFollowers)).filter(Number.isFinite)
    const growth = accounts.map(item => Number(item.growth)).filter(Number.isFinite)
    return {
      current: current.length ? current.reduce((total, value) => total + value, 0) : null,
      growth: growth.length ? growth.reduce((total, value) => total + value, 0) : null
    }
  }

  const history = platform === 'instagram' ? data.instagramFollowers : platform === 'tiktok' ? data.tiktokStats : platform === 'youtube' ? data.youtubeSubscribers : {}
  const entries = Object.entries(history || {}).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return { current: null, growth: null }
  const valueOf = value => Number(value?.followerCount ?? value?.subscriberCount)
  const current = valueOf(entries.at(-1)[1])
  const first = valueOf(entries[0][1])
  return { current: Number.isFinite(current) ? current : null, growth: Number.isFinite(current) && Number.isFinite(first) ? current - first : null }
}

function networkRows(data, tiktokVideos, periodDays, platform) {
  const rows = filterByPeriod(data.metrics, periodDays).filter(item => item.platform === platform && item.metrics)
  if (platform === 'tiktok' && !rows.length) {
    return filterTikTokVideosByPeriod(tiktokVideos, periodDays).map(video => ({
      publishedAt: video.publishedAt || (video.createTime ? new Date(Number(video.createTime) * 1000).toISOString() : null),
      text: video.title || '',
      metrics: { views: video.viewCount, likes: video.likeCount, comments: video.commentCount, shares: video.shareCount }
    }))
  }
  return rows
}

function buildNetworkStats(data, tiktokVideos, periodDays, activeNet = null) {
  return NETWORK_ORDER.filter(platform => !activeNet || platform === activeNet).map(platform => {
    const rows = networkRows(data, tiktokVideos, periodDays, platform)
    const profiles = data.accountAnalytics?.platforms?.[platform] || []
    const reachFromContent = sumNullable(rows, 'reach') ?? sumNullable(rows, 'views')
    const reach = reachFromContent ?? profileMetricFirst(profiles, platform === 'facebook' ? ['page_media_view', 'page_video_views'] : ['reach', 'views'])
    const impressions = sumNullable(rows, 'impressions') ?? profileMetricFirst(profiles, ['impressions', 'account_impressions'])
    const likes = sumNullable(rows, 'likes') ?? profileMetricSum(profiles, ['likes'])
    const comments = sumNullable(rows, 'comments') ?? profileMetricSum(profiles, ['comments'])
    const shares = sumNullable(rows, 'shares') ?? profileMetricSum(profiles, ['shares'])
    const saves = sumNullable(rows, 'saves') ?? profileMetricSum(profiles, ['saves'])
    const interactions = [likes, comments, shares, saves].some(value => value != null)
      ? [likes, comments, shares, saves].reduce((total, value) => total + (value || 0), 0)
      : null
    const audience = audienceStats(data, platform)
    return {
      platform,
      rows,
      content: rows.length,
      reach,
      impressions,
      interactions,
      saves,
      audience: audience.current,
      growth: audience.growth,
      rate: reach > 0 && interactions != null ? interactions / reach * 100 : null
    }
  }).filter(item => item.content || item.reach != null || item.audience != null)
}

function Kpi({ label, value, help, accent = '' }) {
  return <div className={`analytics-executive-kpi ${accent}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{help}</small>
  </div>
}

function formatRate(value) {
  return value == null ? '—' : `${value.toFixed(1)}%`
}

function interactionBreakdown(item) {
  return ['likes', 'comments', 'shares', 'saves'].reduce((total, name) => {
    const value = metricNumber(item.metrics, name)
    return { ...total, [name]: value == null ? 0 : value }
  }, {})
}

export function AnalyticsExecutiveOverview({ data, tiktokVideos, periodDays, activeNet = null, recommendedActions = [] }) {
  const stats = buildNetworkStats(data, tiktokVideos, periodDays, activeNet)
  if (!stats.length) return null

  const totalReach = stats.some(item => item.reach != null) ? stats.reduce((total, item) => total + (item.reach || 0), 0) : null
  const totalImpressions = stats.some(item => item.impressions != null) ? stats.reduce((total, item) => total + (item.impressions || 0), 0) : null
  const totalInteractions = stats.some(item => item.interactions != null) ? stats.reduce((total, item) => total + (item.interactions || 0), 0) : null
  const totalSaves = stats.some(item => item.saves != null) ? stats.reduce((total, item) => total + (item.saves || 0), 0) : null
  const totalContent = stats.reduce((total, item) => total + item.content, 0)
  const totalGrowth = stats.some(item => item.growth != null) ? stats.reduce((total, item) => total + (item.growth || 0), 0) : null
  const avgInteractions = totalInteractions != null && totalContent ? totalInteractions / totalContent : null
  const bestNetwork = [...stats].sort((a, b) => (b.interactions || 0) - (a.interactions || 0))[0]
  const contentRows = stats.flatMap(item => item.rows.map(row => ({ ...row, platform: item.platform })))
  const bestContent = contentRows
    .filter(row => row.metrics)
    .sort((a, b) => {
      const score = row => ['likes', 'comments', 'shares', 'saves'].reduce((total, name) => total + (metricNumber(row.metrics, name) || 0), 0)
      return score(b) - score(a)
    })[0]

  return <section className="analytics-executive-overview" aria-labelledby="analytics-executive-title">
    <div className="analytics-executive-heading">
      <div>
        <p className="analytics-kicker">PAINEL EXECUTIVO</p>
        <h3 id="analytics-executive-title">{activeNet ? `Performance do ${PLAT_LABELS[activeNet]}` : 'Performance consolidada'}</h3>
        <p>{activeNet ? `Uma leitura dos resultados reais somente do ${PLAT_LABELS[activeNet]} no período selecionado.` : 'Uma leitura profissional dos resultados reais de todas as contas no período selecionado.'}</p>
      </div>
      <span className="analytics-executive-source"><i aria-hidden="true"/>Dados das integrações conectadas</span>
    </div>

    <div className="analytics-executive-kpis">
      <Kpi label="Alcance / visualizações" value={totalReach == null ? '—' : fmtNum(totalReach)} help="Soma do alcance ou das visualizações disponíveis." accent="is-gold"/>
      <Kpi label="Impressões" value={totalImpressions == null ? '—' : fmtNum(totalImpressions)} help="Exibido quando a rede fornece esse dado." accent="is-blue"/>
      <Kpi label="Interações" value={totalInteractions == null ? '—' : fmtNum(totalInteractions)} help="Curtidas, comentários, compartilhamentos e salvamentos." accent="is-pink"/>
      <Kpi label="Média por conteúdo" value={avgInteractions == null ? '—' : fmtNum(Math.round(avgInteractions))} help="Interações médias por conteúdo analisado." accent="is-green"/>
      <Kpi label="Salvamentos" value={totalSaves == null ? '—' : fmtNum(totalSaves)} help="Conteúdos salvos pela audiência." accent="is-purple"/>
      <Kpi label="Crescimento da audiência" value={totalGrowth == null ? '—' : `${totalGrowth >= 0 ? '+' : ''}${fmtNum(totalGrowth)}`} help="Variação de seguidores ou inscritos." accent="is-cyan"/>
    </div>

    <div className="analytics-executive-grid">
      <div className="analytics-executive-table-wrap">
          <div className="analytics-executive-section-heading"><div><strong>{activeNet ? `Resultado do ${PLAT_LABELS[activeNet]}` : 'Comparativo por rede'}</strong><span>{activeNet ? 'Alcance, audiência e eficiência desta rede.' : 'Alcance, audiência e eficiência do conteúdo.'}</span></div><b>{totalContent} conteúdos</b></div>
        <div className="analytics-executive-table-scroll"><table>
          <thead><tr><th>Rede</th><th>Conteúdos</th><th>Alcance</th><th>Audiência</th><th>Interações</th><th>Taxa</th></tr></thead>
          <tbody>{stats.map(item => <tr key={item.platform}>
            <td><span className="analytics-executive-network"><i style={{ background: PLAT_COLORS[item.platform] }}><PlatformIcon platform={item.platform} className="h-3 w-3"/></i>{PLAT_LABELS[item.platform]}</span></td>
            <td>{item.content || '—'}</td><td>{item.reach == null ? '—' : fmtNum(item.reach)}</td><td>{item.audience == null ? '—' : fmtNum(item.audience)}</td><td>{item.interactions == null ? '—' : fmtNum(item.interactions)}</td><td>{formatRate(item.rate)}</td>
          </tr>)}</tbody>
        </table></div>
      </div>

      <div className="analytics-executive-highlight">
        <p className="analytics-kicker">DESTAQUE DO PERÍODO</p>
        {bestContent
          ? <>
              <div className="analytics-executive-highlight-network"><span style={{ background: PLAT_COLORS[bestContent.platform] }}><PlatformIcon platform={bestContent.platform} className="h-3.5 w-3.5"/></span>{PLAT_LABELS[bestContent.platform]}</div>
              <strong>{bestContent.text || bestContent.title || 'Conteúdo sem descrição'}</strong>
              <small>{bestContent.publishedAt ? new Date(bestContent.publishedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Data não informada'}</small>
              <div className="analytics-executive-highlight-metrics"><span>♥ {fmtNum(metricNumber(bestContent.metrics, 'likes'))}</span><span>💬 {fmtNum(metricNumber(bestContent.metrics, 'comments'))}</span><span>↗ {fmtNum(metricNumber(bestContent.metrics, 'shares'))}</span><span>🔖 {fmtNum(metricNumber(bestContent.metrics, 'saves'))}</span></div>
            </>
          : <p className="empty-state">Ainda não há dados de conteúdo suficientes para destacar uma publicação.</p>}
        {bestNetwork && (() => {
          const breakdown = bestContent && bestContent.platform === bestNetwork.platform
            ? contentRows
              .filter(row => row.platform === bestNetwork.platform && row.metrics)
              .reduce((total, row) => {
                const rowBreakdown = interactionBreakdown(row)
                return Object.fromEntries(Object.keys(rowBreakdown).map(name => [name, total[name] + rowBreakdown[name]]))
              }, { likes: 0, comments: 0, shares: 0, saves: 0 })
            : null
          const detail = breakdown
            ? ` (${fmtNum(breakdown.likes)} curtidas + ${fmtNum(breakdown.comments)} comentários + ${fmtNum(breakdown.shares)} compartilhamentos + ${fmtNum(breakdown.saves)} salvamentos)`
            : ''
          return <p className="analytics-executive-highlight-note"><b>{activeNet ? 'Rede analisada:' : 'Melhor rede:'}</b> {PLAT_LABELS[bestNetwork.platform]} concentrou {fmtNum(bestNetwork.interactions || 0)} interações no recorte{detail}.</p>
        })()}
      </div>
    </div>

    {recommendedActions.length > 0 && <div className="analytics-performance-report-actions"><strong>Próximos passos recomendados</strong>{recommendedActions.map((action, index) => <p key={action}><b>{index + 1}</b>{action}</p>)}</div>}
  </section>
}
