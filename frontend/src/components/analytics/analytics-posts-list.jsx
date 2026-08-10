import { useState } from 'react'
import { filterByPeriod, filterTikTokVideosByPeriod, fmtNum } from '../../lib/analytics-format.js'
import { CommentsModal } from './comments-modal.jsx'
import { PlatformIcon } from '../ui/platform-icon.jsx'

function TiktokPostsList({ tiktokVideos }) {
  if (!tiktokVideos.length) return <p className="empty-state">Nenhum vídeo publicado.</p>
  return (
    <div className="analytics-posts-list">
      {tiktokVideos.map(v => (
        <a key={v.shareUrl} href={v.shareUrl} target="_blank" rel="noopener noreferrer" className="analytics-post-item">
          {v.coverImageUrl
            ? <img className="analytics-post-thumb" src={v.coverImageUrl} alt=""/>
            : <div className="analytics-post-thumb analytics-post-thumb-fallback"><PlatformIcon platform="tiktok" className="h-5 w-5" /></div>}
          <div className="analytics-post-body">
            <div className="analytics-post-date">{new Date(v.createTime * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
            <div className="analytics-post-text">{v.title ? (v.title.length > 70 ? v.title.slice(0, 70) + '…' : v.title) : <span className="empty-state">Sem título</span>}</div>
          </div>
          <div className="analytics-post-metrics">
            <span title="Visualizações">👁 {fmtNum(v.viewCount)}</span>
            <span title="Curtidas">❤ {fmtNum(v.likeCount)}</span>
            <span title="Comentários">💬 {fmtNum(v.commentCount)}</span>
            <span title="Compartilhamentos">🔁 {fmtNum(v.shareCount)}</span>
          </div>
        </a>
      ))}
    </div>
  )
}

function groupByPost(metrics) {
  const grupos = {}
  for (const m of metrics) {
    const key = m.postId || `${m.text || ''}${m.publishedAt || ''}`
    if (!grupos[key]) grupos[key] = { ...m, plataformas: [] }
    grupos[key].plataformas.push({ platform: m.platform, metrics: m.metrics, postId: m.postId })
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
              <div key={j} className="analytics-post-plat-row">
                <span className={`analytics-post-platform-icon analytics-post-platform-icon-${pl.platform}`} aria-label={pl.platform}>
                  <PlatformIcon platform={pl.platform} className="h-3.5 w-3.5" />
                </span>
                {pl.metrics
                  ? <>
                      <span className="analytics-post-view-metric" title={pl.metrics.views == null ? 'A rede ainda não forneceu a contagem de visualizações' : 'Visualizações'}>👁 {fmtNum(pl.metrics.views)}</span>
                      {pl.metrics.likes != null && <span title="Curtidas">❤ {fmtNum(pl.metrics.likes)}</span>}
                      {pl.metrics.comments != null && <span title="Comentários">💬 {fmtNum(pl.metrics.comments)}</span>}
                      {pl.metrics.shares != null && <span>↗ {fmtNum(pl.metrics.shares)}</span>}
                      {pl.metrics.saves != null && <span>🔖 {fmtNum(pl.metrics.saves)}</span>}
                      {pl.metrics.reactionBreakdown && <span title={Object.entries(pl.metrics.reactionBreakdown).map(([type, value]) => `${type}: ${value}`).join(', ')}>😀 Reações</span>}
                    </>
                  : <span className="empty-state">Sem métricas</span>}
                {pl.platform === 'instagram' && pl.postId && (
                  <button type="button" className="link-button" style={{ fontSize: 10, padding: '2px 7px' }} onClick={e => { e.stopPropagation(); onOpenComments(pl.postId) }}>Ver Comentários</button>
                )}
              </div>
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
    <NetworkPostsList net={net} metrics={metrics} onOpenComments={setCommentsPostId}/>
    {commentsPostId != null && <CommentsModal postId={commentsPostId} onClose={() => setCommentsPostId(null)}/>}
  </>
}
