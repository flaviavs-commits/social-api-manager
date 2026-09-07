import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { PlatformIcon } from '../ui/platform-icon.jsx'

const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
const COMMENTS_REFRESH_INTERVAL_MS = 60_000
const COMMENTS_EMPTY_RETRY_INTERVAL_MS = 60_000
const COMMENTS_EVENTUAL_CONSISTENCY_WINDOW_MS = 5 * COMMENTS_REFRESH_INTERVAL_MS

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

function SafeAvatar({ src, alt = '', className, fallback }) {
  const [failed, setFailed] = useState(false)
  return <span className={className}>{src && !failed ? <img src={src} alt={alt} onError={() => setFailed(true)} /> : fallback}</span>
}

function SafeMedia({ item, index }) {
  const [failed, setFailed] = useState('')
  const isVideo = item.type === 'video' || item.type === 'VIDEO' || item.mediaType === 'video' || item.media_type === 'VIDEO'
  const source = item.url || item.mediaUrl || item.media_url || item.path
  const poster = item.thumbnail || item.thumbnailUrl || item.thumbnail_url || item.poster || (isVideo ? item.path : null)
  if (!source) return null
  if (isVideo && !failed) return <video src={source} poster={poster && poster !== source ? poster : undefined} controls preload="metadata" onError={() => setFailed('video')} />
  if (isVideo && failed === 'video' && poster) return <img src={poster} alt={`Prévia da mídia ${index + 1} da publicação`} onError={() => setFailed('poster')} />
  if (poster && poster !== source && !failed) return <img src={poster} alt={`Prévia da mídia ${index + 1} da publicação`} onError={() => setFailed('poster')} />
  if (!failed) return <img src={source} alt={`Mídia ${index + 1} da publicação`} onError={() => setFailed('image')} />
  return <div className="comments-post-media-fallback">Prévia indisponível</div>
}

function previewFromInboxPost(post) {
  if (!post) return null
  const platform = post.externalPlatform || post.platform || post.platforms?.[0] || 'instagram'
  const account = (post.accounts || []).find(item => item.platform === platform) || (post.accounts || [])[0] || {}
  return {
    ...post,
    id: post.id,
    platform,
    handle: post.handle || account.handle || '',
    avatarUrl: post.avatarUrl || account.avatarUrl || null,
    publishedAt: post.publishedAt || post.scheduledAt || null,
    youtubeTitle: post.youtubeTitle || post.titleByPlatform?.youtube || post.title || '',
    text: post.textByPlatform?.[platform] || post.text || ''
  }
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
        {items.map((item, index) => <SafeMedia key={`${item.url || item.path || index}-${index}`} item={item} index={index} />)}
      </div>
    : <div className="comments-post-media-empty">Esta publicação não tem mídia disponível para visualização.</div>

  return <article className={`comments-post-preview comments-post-preview-${platform}`}>
    <header className="comments-post-account">
      <SafeAvatar src={post.avatarUrl} className={`comments-post-avatar comments-post-avatar-${platform}`} fallback={<PlatformIcon platform={platform} className="h-4 w-4" />} />
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

function CommentRow({ comment, postId, post, platform, replySupported, onReplied, savedTexts = [] }) {
  const [replyText, setReplyText] = useState('')
  const [sentReplies, setSentReplies] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const data = comment.createdAt ? formatDate(comment.createdAt) : ''
  const author = comment.author || 'desconhecido'
  const authorAvatar = comment.authorAvatarUrl || comment.profilePictureUrl || comment.avatarUrl || null
  const viewerName = post?.handle || 'sua conta'

  async function send() {
    const text = replyText.trim()
    if (!text) return setError('Escreva uma resposta antes de enviar')
    setSending(true)
    setError('')
    try {
      const request = post?.remote
        ? { url: '/api/posts/inbox/remote-comments/reply', body: { platform: post.externalPlatform, accountId: post.zernioAccountId, postId: post.externalPostId, commentId: comment.id, text } }
        : { url: `/api/posts/${postId}/comments/${comment.id}/reply`, body: { text } }
      await apiFetch(request.url, { method: 'POST', body: JSON.stringify(request.body) })
      setReplyText('')
      setSentReplies(current => [...current, {
        id: `local-reply-${Date.now()}`,
        author: viewerName,
        text,
        createdAt: new Date().toISOString()
      }])
      onReplied?.()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSending(false)
    }
  }

  async function saveReply() {
    const text = replyText.trim()
    if (!text) return setError('Escreva a resposta antes de salvar.')
    try {
      await apiFetch('/api/saved-texts', { method: 'POST', body: JSON.stringify({ title: 'Resposta salva', body: text }) })
      setError('Resposta salva na biblioteca de textos.')
    } catch (caught) { setError(caught.message) }
  }

  return <article className="comment-row">
    <div className="comment-author-line">
      <SafeAvatar src={authorAvatar} className="comment-author-avatar" fallback={author.slice(0, 1).toUpperCase()} />
      <span className="comment-author">@{author.replace(/^@/, '')}</span>
    </div>
    <p className="comment-text">{comment.text}</p>
    {data && <div className="comment-date">{data}</div>}
    {sentReplies.map(reply => <div className="comment-own-reply" key={reply.id}>
      <div className="comment-own-reply-heading"><span>↳</span><strong>Sua resposta</strong><small>publicada agora</small></div>
      <p>{reply.text}</p>
    </div>)}
    {replySupported
      ? <div className="comment-reply-composer">
          <span className="comment-reply-destination">Será publicada no {PLATFORM_LABELS[platform] || platform || 'rede social'}</span>
          <div className="comment-reply-identity"><SafeAvatar src={post?.avatarUrl} className="comment-reply-identity-avatar" fallback={<PlatformIcon platform={platform} className="h-3 w-3" />} /><span>Respondendo como <strong>@{String(viewerName).replace(/^@/, '')}</strong></span></div>
          <div className="comment-reply-form">
          <input type="text" value={replyText} onChange={event => setReplyText(event.target.value)} placeholder="Responder este comentário..." disabled={sending} onKeyDown={event => { if (event.key === 'Enter') send() }} />
          <button type="button" className="action-button" onClick={send} disabled={sending}>{sending ? 'Publicando…' : 'Responder'}</button>
          </div>
          {savedTexts.length > 0 && <select className="mt-2 w-full rounded-lg border border-subtle bg-app px-2 py-1 text-xs text-zinc-300" value="" onChange={event => setReplyText(event.target.value)}><option value="">Usar resposta salva…</option>{savedTexts.map(item => <option value={item.body} key={item.id}>{item.title || item.body.slice(0, 50)}</option>)}</select>}
          <button type="button" className="link-button mt-1" onClick={saveReply}>Salvar texto atual</button>
        </div>
      : <p className="comment-reply-unavailable">A resposta automática ainda não está disponível para esta rede.</p>}
    {error && <p className="error-message comment-reply-error">{error}</p>}
  </article>
}

export function CommentsModal({ postId, initialPost = null, onClose, embedded = false }) {
  const [comments, setComments] = useState([])
  const [post, setPost] = useState(() => previewFromInboxPost(initialPost))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [waitingForComments, setWaitingForComments] = useState(false)
  const [savedTexts, setSavedTexts] = useState([])

  const load = useCallback((silent = false, signal) => {
    if (!silent) setLoading(true)
    setError('')
    const remote = initialPost?.remote
      ? `?platform=${encodeURIComponent(initialPost.externalPlatform)}&accountId=${encodeURIComponent(initialPost.zernioAccountId)}&postId=${encodeURIComponent(initialPost.externalPostId)}`
      : ''
    return apiFetch(remote ? `/api/posts/inbox/remote-comments${remote}` : `/api/posts/${postId}/comments`, { signal })
      .then(result => {
        if (signal?.aborted) return { aborted: true }
        const nextComments = result.comments || []
        setComments(nextComments)
        setPost(current => ({ ...(current || {}), ...(result.post || {}) }))
        setError(result.error || '')
        if (nextComments.length && !initialPost?.remote) apiFetch(`/api/posts/${postId}/comments/seen`, { method: 'POST', body: JSON.stringify({ commentIds: nextComments.map(comment => comment.id) }) }).catch(() => {})
        return { hasComments: nextComments.length > 0, hasError: Boolean(result.error) }
      })
      .catch(caught => {
        if (signal?.aborted) return { aborted: true }
        setError(caught.message)
        return { hasComments: false, hasError: true }
      })
      .finally(() => { if (!silent && !signal?.aborted) setLoading(false) })
  }, [initialPost, postId])

  useEffect(() => {
    let active = true
    let timer = null
    let controller = new AbortController()
    let version = 0

    // Mostra o post escolhido imediatamente, sem esperar a rede social.
    setPost(previewFromInboxPost(initialPost))
    setComments([])
    setError('')
    setWaitingForComments(false)
    setLoading(true)
    const emptyRetryUntil = Date.now() + COMMENTS_EVENTUAL_CONSISTENCY_WINDOW_MS

    const refresh = (silent = false) => {
      const currentVersion = ++version
      if (timer) window.clearTimeout(timer)
      controller.abort()
      controller = new AbortController()
      load(silent, controller.signal).then(result => {
        if (!active || currentVersion !== version || result?.aborted) return
        const waiting = !result?.hasComments && !result?.hasError && Date.now() < emptyRetryUntil
        setWaitingForComments(waiting)
        const nextRefreshIn = waiting ? COMMENTS_EMPTY_RETRY_INTERVAL_MS : COMMENTS_REFRESH_INTERVAL_MS
        timer = window.setTimeout(() => refresh(true), nextRefreshIn)
      })
    }

    const onFocus = () => refresh(true)
    refresh()
    window.addEventListener('focus', onFocus)
    const closeWithEscape = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
      controller.abort()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [load, onClose, postId])

  useEffect(() => { apiFetch('/api/saved-texts').then(data => setSavedTexts(data.savedTexts || [])).catch(() => {}) }, [])

  const visiblePost = post && String(post.id) === String(postId) ? post : previewFromInboxPost(initialPost)
  const content = <div className={`modal-content${embedded ? ' comments-embedded-content' : ''}`} onClick={event => event.stopPropagation()}>
    <div className="modal-header comments-header">
      <div><p className="eyebrow">PUBLICAÇÃO PUBLICADA</p><h3>Comentários e respostas</h3><p className="comments-conversation-title">Confira o conteúdo e responda sua comunidade sem sair do Inbox.</p></div>
      {!embedded && <button type="button" className="link-button" onClick={onClose} aria-label="Fechar">✕</button>}
    </div>
    <PostPreview post={visiblePost} />
    {error && <p className="error-message" style={{ textAlign: 'center', padding: '1.5rem' }}>{error}</p>}
    {!error && loading && <p className="empty-state" style={{ textAlign: 'center', padding: '1.5rem' }}>Carregando publicação e comentários...</p>}
    {!error && !loading && !comments.length && waitingForComments && <p className="empty-state" role="status" aria-live="polite" style={{ textAlign: 'center', padding: '1.5rem' }}>Aguardando a sincronização dos comentários… verificando novamente.</p>}
    {!error && !loading && !comments.length && !waitingForComments && <p className="empty-state" style={{ textAlign: 'center', padding: '1.5rem' }}>Nenhum comentário ainda.</p>}
    {!error && !loading && comments.length > 0 && <div className="comments-list" aria-label="Comentários da publicação">
      {comments.map(comment => <CommentRow key={comment.id} comment={comment} postId={postId} post={visiblePost} platform={visiblePost?.platform} replySupported={visiblePost?.replySupported} onReplied={load} savedTexts={savedTexts} />)}
    </div>}
  </div>

  return embedded ? <section className="comments-embedded-panel" aria-label="Conversa da publicação">{content}</section> : <div className="modal-overlay" onClick={onClose}>{content}</div>
}
