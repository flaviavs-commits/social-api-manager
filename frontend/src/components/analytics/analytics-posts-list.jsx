import { useState } from 'react'
import { filterByPeriod, filterTikTokVideosByPeriod, fmtNum, PLAT_LABELS } from '../../lib/analytics-format.js'
import { CommentsModal } from './comments-modal.jsx'
import { PlatformIcon } from '../ui/platform-icon.jsx'

function TiktokPostsList({ tiktokVideos }) {
  if (!tiktokVideos.length) return <p className="empty-state">Nenhum vídeo publicado.</p>
  return (
    <div className="analytics-posts-list">
      {tiktokVideos.map((v, index) => {
        const timestamp = Number(v.createTime)
        const publishedAt = v.publishedAt || (Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null)
        const content = <>
          {v.coverImageUrl
            ? <img className="analytics-post-thumb" src={v.coverImageUrl} alt=""/>
            : <div className="analytics-post-thumb analytics-post-thumb-fallback"><PlatformIcon platform="tiktok" className="h-5 w-5" /></div>}
          <div className="analytics-post-body">
            <div className="analytics-post-date">{publishedAt ? new Date(publishedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Data não informada'}</div>
            <div className="analytics-post-text">{v.title ? (v.title.length > 70 ? v.title.slice(0, 70) + '…' : v.title) : <span className="empty-state">Sem título</span>}</div>
          </div>
          <div className="analytics-post-metrics">
            <span title="Visualizações">👁 {fmtNum(v.viewCount)}</span>
            <span title="Curtidas">❤ {fmtNum(v.likeCount)}</span>
            <span title="Comentários">💬 {fmtNum(v.commentCount)}</span>
            <span title="Compartilhamentos">🔁 {fmtNum(v.shareCount)}</span>
          </div>
        </>
        return v.shareUrl
          ? <a key={v.id || v.shareUrl || index} href={v.shareUrl} target="_blank" rel="noopener noreferrer" className="analytics-post-item">{content}</a>
          : <div key={v.id || index} className="analytics-post-item">{content}</div>
      })}
    </div>
  )
}

function groupByPost(metrics) {
  const grupos = {}
  for (const m of metrics) {
    const key = m.postId || `${m.text || ''}${m.publishedAt || ''}`
    if (!grupos[key]) grupos[key] = { ...m, plataformas: [] }
    grupos[key].plataformas.push({ platform: m.platform, metrics: m.metrics, metricsStatus: m.metricsStatus, postId: m.postId })
  }
  return Object.values(grupos)
}

function PostThumb({ post }) {
  const itens = post.mediaItems?.length ? post.mediaItems : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  if (!itens.length) return <div className="analytics-post-thumb analytics-post-thumb-fallback">📝</div>
  const item = itens[0]
  return item.type === 'video'
    ? <video className="analytics-post-thumb" src={item.path}/>
    : <img className="analytics-post-thumb" src={item.path} alt=""/>
}

const METRIC_FIELDS = [
  { key: 'views', label: 'Visualizações', icon: '👁' },
  { key: 'reach', label: 'Alcance', icon: '◎' },
  { key: 'impressions', label: 'Impressões', icon: '◌' },
  { key: 'likes', label: 'Curtidas', icon: '❤' },
  { key: 'comments', label: 'Comentários', icon: '💬' },
  { key: 'shares', label: 'Compartilhamentos', icon: '↗' },
  { key: 'saves', label: 'Salvamentos', icon: '🔖' },
  { key: 'clicks', label: 'Cliques', icon: '⌁' },
  { key: 'follows', label: 'Seguidores ganhos', icon: '+' },
  { key: 'engagedViews', label: 'Visualizações engajadas', icon: '◉' },
  { key: 'estimatedMinutesWatched', label: 'Minutos assistidos', icon: '◷' },
  { key: 'averageViewDuration', label: 'Duração média', icon: '◷' },
  { key: 'averageViewPercentage', label: 'Retenção média', icon: '%' },
  { key: 'dislikes', label: 'Não gostei', icon: '−' },
  { key: 'subscribersGained', label: 'Inscritos ganhos', icon: '+' },
  { key: 'subscribersLost', label: 'Inscritos perdidos', icon: '−' }
]

function metricIsAvailable(value) {
  return value !== null && value !== undefined
}

function formatMetricValue(key, value) {
  if (key === 'averageViewPercentage' || key === 'engagementRate') {
    return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  }
  return fmtNum(value)
}

function formatUpdatedAt(value) {
  if (!value) return 'Atualização não informada pela rede'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Atualização não informada pela rede'
  return `Atualizado em ${date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })}`
}

function PostNetworkMetrics({ platform, metrics, metricsStatus, postId, onOpenComments }) {
  const fields = METRIC_FIELDS.filter(field => metricIsAvailable(metrics?.[field.key]))
  const engagementRate = metricIsAvailable(metrics?.engagementRate)
    ? { key: 'engagementRate', label: 'Taxa de engajamento', icon: '%' }
    : null
  if (engagementRate) fields.push(engagementRate)

  return (
    <div className={`analytics-post-network analytics-post-network-${platform}`}>
      <div className="analytics-post-network-heading">
        <span className={`analytics-post-platform-icon analytics-post-platform-icon-${platform}`} aria-label={platform}>
          <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
        </span>
        <strong>{PLAT_LABELS[platform] || platform}</strong>
        <span className="analytics-post-sync-status">{formatUpdatedAt(metrics?.lastUpdated)}</span>
      </div>
      {metrics
        ? <>
            <div className="analytics-post-metric-grid">
              {fields.length
                ? fields.map(field => (
                    <span key={field.key} className="analytics-post-metric" title={field.label}>
                      <span className="analytics-post-metric-icon" aria-hidden="true">{field.icon}</span>
                      <span className="analytics-post-metric-label">{field.label}</span>
                      <strong>{formatMetricValue(field.key, metrics[field.key])}</strong>
                    </span>
                  ))
                : <span className="empty-state">A rede ainda não retornou métricas para este post.</span>}
            </div>
            {metrics.reactionBreakdown && (
              <div className="analytics-post-reactions">
                Reações: {Object.entries(metrics.reactionBreakdown).map(([type, value]) => `${type} ${fmtNum(value)}`).join(' · ')}
              </div>
            )}
            <div className="analytics-post-network-actions">
              {metrics.platformUrl && (
                <a href={metrics.platformUrl} target="_blank" rel="noopener noreferrer" className="link-button">Abrir na rede</a>
              )}
              {platform === 'instagram' && postId && (
                <button type="button" className="link-button" onClick={() => onOpenComments(postId)}>Ver comentários</button>
              )}
            </div>
          </>
        : <div className="analytics-post-no-metrics">
            {metricsStatus === 'missing_external_id'
              ? 'Sem ID externo: reconecte a conta ou publique novamente para sincronizar os dados.'
              : 'Não foi possível sincronizar os dados deste post agora.'}
          </div>}
    </div>
  )
}

function NetworkPostsList({ net, metrics, onOpenComments }) {
  const posts = groupByPost(metrics).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  if (!posts.length) return <p className="empty-state">Nenhum post no período.</p>

  return (
    <div className="analytics-posts-list">
      {posts.map((post, i) => (
        <div key={post.postId || i} className="analytics-post-item">
          <PostThumb post={post}/>
          <div className="analytics-post-body">
            <div className="analytics-post-date">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</div>
            <div className="analytics-post-text">{post.text || post.youtubeTitle ? (post.text || post.youtubeTitle).slice(0, 70) : <span className="empty-state">Sem texto</span>}</div>
          </div>
          <div className="analytics-post-platforms">
            {post.plataformas.map((pl, j) => (
              <PostNetworkMetrics key={`${pl.platform}-${j}`} platform={pl.platform} metrics={pl.metrics} metricsStatus={pl.metricsStatus} postId={pl.postId} onOpenComments={onOpenComments}/>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AnalyticsPostsList({ net, tab, data, tiktokVideos, periodDays }) {
  const [commentsPostId, setCommentsPostId] = useState(null)
  if (tab !== 'posts' && tab !== 'videos') return null

  if (net === 'tiktok') return <TiktokPostsList tiktokVideos={filterTikTokVideosByPeriod(tiktokVideos, periodDays)}/>

  const metrics = filterByPeriod(data.metrics, periodDays).filter(m => m.platform === net)
  return <>
    <div className="analytics-posts-live-note">Dados reais por publicação e rede. A lista é atualizada automaticamente.</div>
    <NetworkPostsList net={net} metrics={metrics} onOpenComments={setCommentsPostId}/>
    {commentsPostId != null && <CommentsModal postId={commentsPostId} onClose={() => setCommentsPostId(null)}/>}
  </>
}
