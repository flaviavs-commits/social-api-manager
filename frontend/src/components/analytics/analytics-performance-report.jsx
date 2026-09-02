import {
  accountAnalyticsPlatformTotals,
  filterByPeriod,
  filterByPeriodOffset,
  filterTikTokVideosByPeriod,
  filterTikTokVideosByPeriodOffset,
  fmtNum,
  NETWORK_ORDER,
  PLAT_LABELS,
} from '../../lib/analytics-format.js'

function numberValue(value) {
  const normalized = value && typeof value === 'object' ? value.total : value
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function sumRows(rows, name) {
  const values = rows.map(row => numberValue(row.metrics?.[name])).filter(value => value != null)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function sumVideos(videos, name) {
  const values = videos.map(video => numberValue(video[name])).filter(value => value != null)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function hasMetricData(row) {
  return ['views', 'likes', 'comments', 'shares', 'saves'].some(name => numberValue(row.metrics?.[name]) != null)
}

function rowsFor(data, tiktokVideos, periodDays, platform, offset = 0) {
  const rows = filterByPeriodOffset(data.metrics, periodDays, offset).filter(item => item.platform === platform && hasMetricData(item))
  if (platform === 'tiktok') {
    const videos = filterTikTokVideosByPeriodOffset(tiktokVideos, periodDays, offset).map(video => ({
      publishedAt: video.publishedAt || (video.createTime ? new Date(Number(video.createTime) * 1000).toISOString() : null),
      text: video.title || '',
      metrics: { views: video.viewCount, likes: video.likeCount, comments: video.commentCount, shares: video.shareCount, saves: video.saveCount },
    }))
    if (videos.some(hasMetricData) || !rows.length) return videos
  }
  return rows
}

function audienceFor(data, platform) {
  const followerAccounts = (data.accountAnalytics?.followerStats?.accounts || []).filter(item => item.platform === platform)
  if (followerAccounts.length) {
    const current = followerAccounts.map(item => numberValue(item.currentFollowers)).filter(value => value != null)
    const growth = followerAccounts.map(item => numberValue(item.growth)).filter(value => value != null)
    return {
      current: current.length ? current.reduce((total, value) => total + value, 0) : null,
      growth: growth.length ? growth.reduce((total, value) => total + value, 0) : null,
    }
  }

  const history = platform === 'instagram' ? data.instagramFollowers : platform === 'tiktok' ? data.tiktokStats : platform === 'youtube' ? data.youtubeSubscribers : {}
  const entries = Object.entries(history || {}).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return { current: null, growth: null }
  const valueOf = value => numberValue(value?.followerCount ?? value?.subscriberCount)
  const current = valueOf(entries.at(-1)[1])
  const first = valueOf(entries[0][1])
  return { current, growth: current != null && first != null ? current - first : null }
}

function fallbackTotal(platformTotals, platform, key) {
  const entry = platformTotals[platform]?.[key]
  return entry?.hasData ? entry.value : null
}

function interactionScore(row) {
  return ['likes', 'comments', 'shares', 'saves']
    .reduce((sum, name) => sum + (numberValue(row.metrics?.[name]) || 0), 0)
}

function interactionTotal(row) {
  const values = ['likes', 'comments', 'shares', 'saves']
    .map(name => numberValue(row?.metrics?.[name]))
    .filter(value => value != null)
  return values.length ? values.reduce((sum, current) => sum + current, 0) : null
}

function contentTitle(row) {
  return row?.text || row?.title || row?.youtubeTitle || row?.caption || 'Conteúdo sem descrição'
}

function contentFormat(row) {
  return {
    image: 'imagem',
    video: 'vídeo',
    carousel: 'carrossel',
  }[row?.mediaType] || 'conteúdo'
}

function shortContentTitle(row, maxLength = 84) {
  const title = contentTitle(row).replace(/\s+/g, ' ').trim()
  return title.length > maxLength ? `${title.slice(0, maxLength - 1).trimEnd()}…` : title
}

function interactionBreakdown(row) {
  return {
    likes: numberValue(row?.metrics?.likes),
    comments: numberValue(row?.metrics?.comments),
    shares: numberValue(row?.metrics?.shares),
    saves: numberValue(row?.metrics?.saves),
  }
}

export function buildPerformanceReport(data, tiktokVideos, periodDays, activeNet = null) {
  const platformTotals = accountAnalyticsPlatformTotals(data.accountAnalytics)
  const platforms = NETWORK_ORDER
    .filter(platform => !activeNet || platform === activeNet)
    .map(platform => {
      const rows = rowsFor(data, tiktokVideos, periodDays, platform)
      const previousRows = rowsFor(data, tiktokVideos, periodDays, platform, 1)
      const views = sumRows(rows, 'views') ?? sumVideos(platform === 'tiktok' ? filterTikTokVideosByPeriod(tiktokVideos, periodDays) : [], 'viewCount') ?? fallbackTotal(platformTotals, platform, 'views')
      const likes = sumRows(rows, 'likes') ?? fallbackTotal(platformTotals, platform, 'likes')
      const comments = sumRows(rows, 'comments') ?? fallbackTotal(platformTotals, platform, 'comments')
      const shares = sumRows(rows, 'shares') ?? fallbackTotal(platformTotals, platform, 'shares')
      const saves = sumRows(rows, 'saves')
      const impressions = sumRows(rows, 'impressions')
      const interactions = [likes, comments, shares, saves].some(value => value != null)
        ? [likes, comments, shares, saves].reduce((total, value) => total + (value || 0), 0)
        : fallbackTotal(platformTotals, platform, 'engagement')
      const previousViews = sumRows(previousRows, 'views')
      const previousInteractions = [sumRows(previousRows, 'likes'), sumRows(previousRows, 'comments'), sumRows(previousRows, 'shares'), sumRows(previousRows, 'saves')]
        .some(value => value != null)
        ? [sumRows(previousRows, 'likes'), sumRows(previousRows, 'comments'), sumRows(previousRows, 'shares'), sumRows(previousRows, 'saves')].reduce((total, value) => total + (value || 0), 0)
        : null
      const audience = audienceFor(data, platform)
      const contentRows = rows.filter(hasMetricData)
      const bestContent = [...contentRows]
        .sort((a, b) => interactionScore(b) - interactionScore(a) || (numberValue(b.metrics?.views) || 0) - (numberValue(a.metrics?.views) || 0))[0] || null
      return {
        platform,
        rows,
        bestContent,
        content: rows.length,
        views,
        likes,
        comments,
        shares,
        saves,
        impressions,
        interactions,
        rate: views > 0 && interactions != null ? interactions / views * 100 : null,
        audience: audience.current,
        growth: audience.growth,
        previousViews,
        previousInteractions,
      }
    })

  const total = key => {
    const values = platforms.map(item => item[key]).filter(value => value != null)
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null
  }
  const totals = {
    content: platforms.reduce((sum, item) => sum + item.content, 0),
    views: total('views'),
    interactions: total('interactions'),
    audience: total('audience'),
    growth: total('growth'),
    impressions: total('impressions'),
    saves: total('saves'),
  }
  totals.rate = totals.views > 0 && totals.interactions != null ? totals.interactions / totals.views * 100 : null

  const contentRows = platforms.flatMap(item => item.rows.map(row => ({ ...row, platform: item.platform }))).filter(hasMetricData)
  const bestContent = [...contentRows].sort((a, b) => interactionScore(b) - interactionScore(a) || (numberValue(b.metrics?.views) || 0) - (numberValue(a.metrics?.views) || 0))[0] || null
  const previousViewValues = platforms.map(item => item.previousViews).filter(value => value != null)
  const previousInteractionValues = platforms.map(item => item.previousInteractions).filter(value => value != null)
  const previousViews = previousViewValues.length ? previousViewValues.reduce((sum, value) => sum + value, 0) : null
  const previousInteractions = previousInteractionValues.length ? previousInteractionValues.reduce((sum, value) => sum + value, 0) : null
  return { platforms, totals, previousViews, previousInteractions, bestContent }
}

function changeText(current, previous, label) {
  if (current == null || previous == null || previous === 0) return `Sem comparação de ${label} disponível.`
  const change = (current - previous) / previous * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% em relação ao período anterior.`
}

export function performanceReportConclusion(report) {
  const { totals } = report
  if (!totals.content && totals.views == null) return 'Ainda não há dados suficientes para explicar o desempenho. Publique ou conecte uma conta para formar a primeira base de comparação.'
  if (totals.rate == null) return 'Há volume de conteúdo, mas as redes não forneceram dados suficientes para calcular a taxa de interação.'
  if (totals.rate < 1) return 'O conteúdo está alcançando pessoas, porém poucas estão reagindo. O próximo teste deve priorizar chamadas para comentar, salvar ou compartilhar.'
  if (totals.rate < 3) return 'O conteúdo já gera reação, mas há espaço para aumentar a participação. Vale repetir os temas que mais provocaram comentários e compartilhamentos.'
  return 'A audiência está reagindo de forma consistente. Preserve os formatos de melhor resultado e teste variações sem perder o tema que já funciona.'
}

export function performanceReportActions(report) {
  const { totals, bestContent } = report
  if (!totals.content && totals.views == null) return ['Publique um novo conteúdo para criar uma base real de comparação.', 'Mantenha o mesmo período de análise após a publicação para medir a evolução.']
  const actions = []
  if (totals.rate != null && totals.rate < 2) actions.push('Use uma chamada objetiva no texto ou no vídeo para estimular comentários, salvamentos e compartilhamentos.')
  if (bestContent) {
    const interactions = interactionBreakdown(bestContent)
    const totalInteractions = interactionTotal(bestContent)
    const interactionDetails = [
      ['likes', 'curtidas'],
      ['comments', 'comentários'],
      ['shares', 'compartilhamentos'],
      ['saves', 'salvamentos'],
    ]
      .filter(([name]) => interactions[name] != null)
      .map(([name, label]) => `${fmtNum(interactions[name])} ${label}`)
      .join(' + ')
    const date = bestContent.publishedAt
      ? new Date(bestContent.publishedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'data não informada'
    const views = numberValue(bestContent.metrics?.views)
    actions.push(`Analise e replique este ${contentFormat(bestContent)} de ${PLAT_LABELS[bestContent.platform] || bestContent.platform}, publicado em ${date}: “${shortContentTitle(bestContent)}”. ${totalInteractions == null ? 'A rede confirmou o conteúdo, mas não informou interações.' : `Ele gerou ${fmtNum(totalInteractions)} ${totalInteractions === 1 ? 'interação' : 'interações'}${interactionDetails ? ` (${interactionDetails})` : ''}`}${views == null ? '.' : ` em ${fmtNum(views)} visualizações.`}`)
  }
  if (totals.growth != null && totals.growth < 0) actions.push('Revise os conteúdos que coincidiram com a queda de audiência e teste temas ou horários diferentes.')
  if (!actions.length) actions.push('Repita os temas e formatos que trouxeram mais interações, acompanhando a taxa para validar a evolução.')
  return actions.slice(0, 3)
}

function value(value) {
  return value == null ? '—' : fmtNum(Math.round(value))
}

export function AnalyticsPerformanceReport({ data, tiktokVideos, periodDays, activeNet = null }) {
  const report = buildPerformanceReport(data, tiktokVideos, periodDays, activeNet)
  const { totals } = report
  const scope = activeNet ? PLAT_LABELS[activeNet] || activeNet : 'todas as redes'

  return <section className="analytics-performance-report" aria-labelledby="analytics-performance-report-title">
    <div className="analytics-performance-report-heading">
      <div>
        <p className="analytics-kicker">RELATÓRIO INTERPRETATIVO</p>
        <h3 id="analytics-performance-report-title">Desempenho explicado</h3>
        <p>Uma leitura do que aconteceu, do que isso significa e qual deve ser o próximo teste.</p>
      </div>
      <span className="analytics-performance-report-scope">{scope} · {periodDays} dias</span>
    </div>

    <div className="analytics-performance-report-summary">
      <span className="analytics-performance-report-mark" aria-hidden="true">✓</span>
      <p>{performanceReportConclusion(report)}</p>
    </div>

    <div className="analytics-performance-report-facts">
      <article><strong>{value(totals.views)}</strong><span>Alcance / visualizações</span><p>Indica quantas vezes o conteúdo foi visto. Não significa necessariamente pessoas únicas.</p></article>
      <article><strong>{value(totals.interactions)}</strong><span>Interações</span><p>Soma de curtidas, comentários, compartilhamentos e salvamentos quando a rede fornece esses dados.</p></article>
      <article><strong>{totals.rate == null ? '—' : `${totals.rate.toFixed(1)}%`}</strong><span>Taxa de interação</span><p>Interações divididas pelas visualizações. Ajuda a medir a reação proporcional ao alcance.</p></article>
      <article><strong>{value(totals.growth)}</strong><span>Crescimento da audiência</span><p>Variação de seguidores ou inscritos. A soma entre redes não representa pessoas únicas.</p></article>
      <article><strong>{value(totals.impressions)}</strong><span>Impressões</span><p>Quantidade de vezes que o conteúdo apareceu, quando a rede disponibiliza essa métrica.</p></article>
      <article><strong>{value(totals.saves)}</strong><span>Salvamentos</span><p>Sinal de que a audiência considerou o conteúdo útil para consultar novamente.</p></article>
    </div>

    <div className="analytics-performance-report-grid">
      <div className="analytics-performance-report-table-wrap">
        <div className="analytics-performance-report-section-heading"><div><strong>Leitura por rede</strong><span>Onde o conteúdo encontrou mais alcance e reação.</span></div><b>{totals.content} conteúdos</b></div>
        <div className="analytics-performance-report-table-scroll"><table>
          <thead><tr><th>Rede</th><th>Conteúdos</th><th>Visualizações</th><th>Interações</th><th>Taxa</th></tr></thead>
          <tbody>{report.platforms.map(item => <tr key={item.platform}><td>{PLAT_LABELS[item.platform] || item.platform}</td><td>{item.content}</td><td>{value(item.views)}</td><td>{value(item.interactions)}</td><td>{item.rate == null ? '—' : `${item.rate.toFixed(1)}%`}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="analytics-performance-report-reading">
        <strong>O que mudou</strong>
        <p>Visualizações: {changeText(totals.views, report.previousViews, 'visualizações')}</p>
        <p>Interações: {changeText(totals.interactions, report.previousInteractions, 'interações')}</p>
      </div>
    </div>

    <div className="analytics-performance-report-network-highlights">
      <div className="analytics-performance-report-section-heading">
        <div><strong>Melhor conteúdo por rede</strong><span>O destaque é escolhido dentro de cada plataforma pelo maior número de interações no período.</span></div>
        <b>{report.platforms.length} redes</b>
      </div>
      <div className="analytics-performance-report-network-highlights-grid">
        {report.platforms.map(item => {
          const bestContent = item.bestContent
          const interactions = bestContent ? interactionTotal(bestContent) : null
          return <article key={item.platform} className="analytics-performance-report-network-highlight">
            <div className="analytics-performance-report-network-highlight-heading">
              <strong>{PLAT_LABELS[item.platform] || item.platform}</strong>
              <span className={bestContent ? 'has-data' : ''}>{bestContent ? 'Métricas confirmadas' : 'Sem dados confirmados'}</span>
            </div>
            {bestContent ? <>
              <p className="analytics-performance-report-network-highlight-title">{contentTitle(bestContent)}</p>
              <small>{bestContent.publishedAt ? new Date(bestContent.publishedAt).toLocaleDateString('pt-BR') : 'Data não informada'}</small>
              <div className="analytics-performance-report-network-highlight-metrics"><span><b>{value(interactions)}</b> interações</span><span><b>{value(numberValue(bestContent.metrics?.views))}</b> visualizações</span></div>
            </> : <p className="analytics-performance-report-network-highlight-empty">Nenhum post com visualizações e interações confirmadas desta rede no período.</p>}
          </article>
        })}
      </div>
    </div>

    <p className="analytics-performance-report-note"><b>Fonte e limites:</b> o relatório usa os dados retornados pelas integrações conectadas e os conteúdos carregados no período selecionado. Algumas redes não fornecem todas as métricas; nesses casos, o campo aparece como “—” e não é estimado.</p>
  </section>
}
