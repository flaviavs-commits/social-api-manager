import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'

function PostPreview({ post }) {
  if (!post) return null
  const itens = post.mediaItems?.length ? post.mediaItems : (post.mediaPath ? [{ path: post.mediaPath, type: post.mediaType }] : [])
  return (
    <div className="comments-post-preview">
      {itens.length > 0 && <div className="comments-post-media">
        {itens.map((item, i) => item.type === 'video'
          ? <video key={i} src={item.path} controls/>
          : <img key={i} src={item.path} alt=""/>)}
      </div>}
      {post.text && <div className="comments-post-text">{post.text}</div>}
    </div>
  )
}

function CommentRow({ comment, postId, onReplied }) {
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const data = comment.createdAt ? new Date(comment.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''

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

  return (
    <div className="comment-row">
      <div className="comment-author">@{comment.author}</div>
      <div className="comment-text">{comment.text}</div>
      <div className="comment-date">{data}</div>
      <div className="comment-reply-form">
        <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Escreva uma resposta..." disabled={sending}/>
        <button type="button" className="action-button" onClick={send} disabled={sending}>{sending ? '...' : 'Enviar'}</button>
      </div>
      {error && <p className="error-message" style={{ fontSize: 12, margin: '4px 0 0' }}>{error}</p>}
    </div>
  )
}

export function CommentsModal({ postId, onClose, embedded = false }) {
  const [comments, setComments] = useState([])
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    setError('')
    apiFetch(`/api/posts/${postId}/comments`)
      .then(result => {
        const nextComments = result.comments || []
        setComments(nextComments)
        setPost(result.post || null)
        if (nextComments.length) apiFetch(`/api/posts/${postId}/comments/seen`, { method: 'POST', body: JSON.stringify({ commentIds: nextComments.map(comment => comment.id) }) }).catch(() => {})
      })
      .catch(caught => setError(caught.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const closeWithEscape = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeWithEscape)
    return () => document.removeEventListener('keydown', closeWithEscape)
  }, [postId, onClose])

  const content = <div className={`modal-content${embedded ? ' comments-embedded-content' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><div><h3>Comentários</h3>{post?.text && <p className="comments-conversation-title">{post.text}</p>}</div>{!embedded && <button type="button" className="link-button" onClick={onClose}>✕</button>}</div>
        <PostPreview post={post}/>
        {error && <p className="error-message" style={{ textAlign: 'center', padding: '1.5rem' }}>{error}</p>}
        {!error && loading && <p className="empty-state" style={{ textAlign: 'center', padding: '1.5rem' }}>Carregando...</p>}
        {!error && !loading && !comments.length && <p className="empty-state" style={{ textAlign: 'center', padding: '1.5rem' }}>Nenhum comentário ainda.</p>}
        {!error && !loading && comments.length > 0 && <div className="comments-list">
          {comments.map(comment => <CommentRow key={comment.id} comment={comment} postId={postId} onReplied={load}/>)}
        </div>}
      </div>

  return embedded ? <section className="comments-embedded-panel" aria-label="Conversa da publicação">{content}</section> : <div className="modal-overlay" onClick={onClose}>{content}</div>
}
