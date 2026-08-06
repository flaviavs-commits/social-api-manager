import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { PlatformIcon } from '../ui/platform-icon.jsx'

const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' }

function formatDate(value) {
  if (!value) return 'data não informada'
  try {
    return new Date(value).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', dateStyle: 'medium', timeStyle: 'short'
    })
  } catch { return 'data não informada' }
}

function mediaItemsOf(post) {
  return post.mediaItems?.length
    ? post.mediaItems
    : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
}

function PostPreview({ post }) {
  if (!post) return null
  const platform = post.platform || 'instagram'
  const label = PLATFORM_LABELS[platform] || platform
  const items = mediaItemsOf(post)
  const handle = post.handle ? (String(post.handle).startsWith('@') ? post.handle : `@${post.handle}`) : 'Sua publicação'
  const caption = post.text || ''
  const isFacebook = platform === 'facebook'
  const isYoutube = platform === 'youtube'

  const media = items.length > 0
    ? <div className="comments-post-media" aria-label={`${items.length} mídia${items.length > 1 ? 's' : ''} da publicação`}>
        {items.map((item, index) => {
          const source = item.path || item.url || item.mediaUrl
          if (!source) return null
          return item.type === 'video' || item.type === 'VIDEO'
            ? <video key={`${source}-${index}`} src={source} controls preload="metadata" />
            : <img key={`${source}-${index}`} src={source} alt={`Mídia ${index + 1} da publicação`} />
        })}
      </div>
    : <div className="comments-post-media-empty">Esta publicação não tem mídia disponível para visualização.</div>

  return <article className={`comments-post-preview comments-post-preview-${platform}`}>
    <header className="comments-post-account">
      <span className={`comments-post-avatar comments-post-avatar-${platform}`}>
        {post.avatarUrl ? <img src={post.avatarUrl} alt="" /> : <PlatformIcon platform={platform} className="h-4 w-4" />}
      </span>
      <span className="comments-post-account-copy"><strong>{handle}</strong><small>{label} · publicado em {formatDate(post.publishedAt)}</small></span>
      <span className="comments-post-platform-icon" aria-hidden="true"><PlatformIcon platform={platform} className="h-4 w-4" /></span>
    </header>

    {isFacebook && caption && <p className="comments-post-caption comments-post-caption-top">{caption}</p>}
    {media}
    {isYoutube && <div className="comments-post-youtube-copy"><strong>{post.youtubeTitle || caption || 'Vídeo publicado'}</strong>{post.youtubeTitle && caption && <p>{caption}</p>}</div>}
    {!isFacebook && !isYoutube && caption && <p className="comments-post-caption">{caption}</p>}
    {!isFacebook && isYoutube && !post.youtubeTitle && !caption && null}
    {isFacebook && !caption && <p className="comments-post-caption comments-post-caption-empty">Publicação sem texto.</p>}
    <div className="comments-post-actions" aria-hidden="true">
      <span>♡ Curtir</span><span>◌ Comentar</span><span>↗ Compartilhar</span>
    </div>
  </article>
}

function CommentRow({ comment, postId, replySupported, onReplied }) {
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const data = comment.createdAt ? formatDate(comment.createdAt) : ''
  const author = comment.author || 'desconhecido'

  async function send() {
    const text = replyText.trim()
    if (!text) return setError('Escreva uma resposta antes de enviar')
    setSending(true)
    setError('')
    try {
      await apiFetch(`/api/posts/${postId}/comments/${comment.id}/reply`, { method: 'POST', body: JSON.stringify({ text }) })
      setReplyText('')
      onReplied?.()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSending(false)
    }
  }

  return <article className="comment-row">
    <div className="comment-author-line">
      <span className="comment-author-avatar">{author.slice(0, 1).toUpperCase()}</span>
      <span className="comment-author">@{author.replace(/^@/, '')}</span>
    </div>
    <p className="comment-text">{comment.text}</p>
    {data && <div className="comment-date">{data}</div>}
    {replySupported
      ? <div className="comment-reply-form">
          <input type="text" value={replyText} onChange={event => setReplyText(event.target.value)} placeholder="Responder este comentário..." disabled={sending} onKeyDown={event => { if (event.key === 'Enter') send() }} />
          <button type="button" className="action-button" onClick={send} disabled={sending}>{sending ? 'Enviando…' : 'Responder'}</button>
        </div>
      : <p className="comment-reply-unavailable">A resposta automática ainda não está disponível para esta rede.</p>}
    {error && <p className="error-message comment-reply-error">{error}</p>}
  </article>
}

export function CommentsModal({ postId, onClose, embedded = false }) {
  const [comments, setComments] = useState([])
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    apiFetch(`/api/posts/${postId}/comments`)
      .then(result => {
        const nextComments = result.comments || []
        setComments(nextComments)
        setPost(result.post || null)
        setError(result.error || '')
        if (nextComments.length) apiFetch(`/api/posts/${postId}/comments/seen`, { method: 'POST', body: JSON.stringify({ commentIds: nextComments.map(comment => comment.id) }) }).catch(() => {})
      })
      .catch(caught => setError(caught.message))
      .finally(() => { if (!silent) setLoading(false) })
  }, [postId])

  useEffect(() => {
    load()
    const refresh = () => load(true)
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    const closeWithEscape = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [load, onClose])

  const content = <div className={`modal-content${embedded ? ' comments-embedded-content' : ''}`} onClick={event => event.stopPropagation()}>
    <div className="modal-header comments-header">
      <div><p className="eyebrow">PUBLICAÇÃO PUBLICADA</p><h3>Comentários e respostas</h3><p className="comments-conversation-title">Confira o conteúdo e responda sua comunidade sem sair do Inbox.</p></div>
      {!embedded && <button type="button" className="link-button" onClick={onClose} aria-label="Fechar">✕</button>}
    </div>
    <PostPreview post={post} />
    {error && <p className="error-message" style={{ textAlign: 'center', padding: '1.5rem' }}>{error}</p>}
    {!error && loading && <p className="empty-state" style={{ textAlign: 'center', padding: '1.5rem' }}>Carregando publicação e comentários...</p>}
    {!error && !loading && !comments.length && <p className="empty-state" style={{ textAlign: 'center', padding: '1.5rem' }}>Nenhum comentário ainda.</p>}
    {!error && !loading && comments.length > 0 && <div className="comments-list" aria-label="Comentários da publicação">
      {comments.map(comment => <CommentRow key={comment.id} comment={comment} postId={postId} replySupported={post?.replySupported} onReplied={load} />)}
    </div>}
  </div>

  return embedded ? <section className="comments-embedded-panel" aria-label="Conversa da publicação">{content}</section> : <div className="modal-overlay" onClick={onClose}>{content}</div>
}
