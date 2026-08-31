import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api.js'

function persistMessage(contexto, role, conteudo) {
  apiFetch('/api/ai/chat-messages', { method: 'POST', body: JSON.stringify({ contexto, role, conteudo }) }).catch(() => {})
}

const AI_POST_DRAFT_KEY = 'meu-ecoo:ai-post-draft'
const AI_REQUEST_TIMEOUT_MS = 120_000

function processingMessageFor(text) {
  const normalized = text.toLowerCase()
  if (/(imagem|arte|visual|foto|banner|thumbnail)/.test(normalized)) return 'Estou preparando sua imagem. Isso pode levar alguns segundos...'
  if (/(visualiza|desempenho|analytics|analis|alcance|engajamento)/.test(normalized)) return 'Estou analisando seus dados para encontrar o que funcionou melhor...'
  if (/(post|publica|legenda|caption|conteúdo|conteudo)/.test(normalized)) return 'Estou preparando o conteúdo ideal para você...'
  return 'Estou entendendo seu pedido e preparando a melhor resposta...'
}

function friendlyAgentError(error) {
  if (error?.status === 408 || /tempo esgotado|timeout/i.test(error?.message || '')) {
    return 'A IA está levando mais tempo que o esperado para concluir essa tarefa. Aguarde alguns instantes antes de tentar novamente; sua solicitação pode ainda estar sendo processada.'
  }
  return error?.message || 'Não consegui concluir a solicitação agora. Tente novamente em alguns instantes.'
}

function storeAiPostDraft(postDraft) {
  const payload = { ...postDraft, savedAt: new Date().toISOString() }
  // A referência em memória evita perder uma imagem grande por limite de
  // sessionStorage; o storage mantém o fluxo funcionando após uma navegação.
  window.__socialAiPostDraft = payload
  try { sessionStorage.setItem(AI_POST_DRAFT_KEY, JSON.stringify(payload)) } catch {}
}

function summarizeData(data) {
  if (!data) return ''
  if (data.image) return `Imagem gerada${data.fallback ? ' após fallback automático' : ''}.`
  if (data.capabilities) return data.capabilities.map(item => `• ${item.label}: ${item.description}`).join('\n')
  if (data.posts) return data.posts.slice(0, 8).map(post => `• #${post.id || '—'} ${post.text || post.title || post.texto || 'Publicação sem texto'} (${post.status || 'sem status'})`).join('\n')
  if (data.drafts) return data.drafts.slice(0, 8).map(draft => `• Rascunho #${draft.id}: ${draft.text || draft.title || 'sem texto'}`).join('\n')
  if (data.accounts) return data.accounts.map(account => `• Conta #${account.id}: ${account.name || account.handle || account.platform}`).join('\n')
  if (data.tokens) return data.tokens.map(token => `• ${token.account_name || token.accountName || token.platform}: ${token.status || 'sem status'}`).join('\n')
  if (data.requirements) return Object.entries(data.requirements).map(([platform, requirement]) => `• ${platform}: mídia ${requirement.media}; ${requirement.observação}`).join('\n')
  if (data.savedTexts) return data.savedTexts.slice(0, 8).map(item => `• Texto #${item.id}: ${item.title || item.body || 'sem título'}`).join('\n')
  if (data.presets) return data.presets.slice(0, 8).map(item => `• Preset #${item.id}: ${item.name} (${item.platform})`).join('\n')
  if (data.memories) return data.memories.slice(0, 8).map(item => `• Memória #${item.id}: ${item.conteudo}`).join('\n')
  if (data.logs) return data.logs.slice(0, 8).map(item => `• ${item.platform || 'sistema'}: ${item.message}`).join('\n')
  if (data.videos) return data.videos.slice(0, 8).map(item => `• ${item.title || item.description || item.id || 'Vídeo do TikTok'}: ${item.viewCount ?? item.view_count ?? 0} visualizações`).join('\n')
  if (data.insight) return data.insight
  if (data.unread) return Object.entries(data.unread).map(([postId, count]) => `• Post #${postId}: ${count} não lido(s)`).join('\n')
  if (data.status) return Object.entries(data.status).map(([platform, status]) => `• ${platform}: ${status}`).join('\n')
  if (data.post) return `• Post #${data.post.id}: ${data.post.text || 'sem texto'} (${data.post.status || 'sem status'})`
  if (data.history) return data.history.slice(0, 8).map(item => `• ${item.platform || 'rede'}: ${item.likes ?? 0} curtidas, ${item.comments ?? 0} comentários, ${item.views ?? 0} visualizações`).join('\n')
  if (data.reply) return `Resposta: ${data.reply.text || data.reply.message || 'publicada'}`
  if (data.summary) return Object.entries(data.summary).map(([key, value]) => `• ${key}: ${value}`).join('\n')
  return ''
}

function RobotAvatar({ size = 'small' }) {
  return <span className={`ai-robot-avatar ai-robot-avatar--${size}`} aria-hidden="true">
    <img src="/logo-icon.png" alt="" />
  </span>
}

function AgentMessage({ message, index, onConfirm, onEdit, editingIndex, onChangeMessage, onContinueToPost }) {
  const summary = summarizeData(message.data)
  const image = message.data?.image
  return (
    <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-snug ${message.role === 'user' ? 'ml-auto bg-gold/15 text-zinc-100' : 'bg-surface-soft text-zinc-200'}`}>
      {message.role === 'agent' && editingIndex === index
        ? <textarea value={message.text} onChange={event => onChangeMessage(index, event.target.value)} aria-label="Editar resposta da IA" className="w-full rounded border border-subtle bg-app p-2 text-sm text-zinc-100" />
        : <span className="whitespace-pre-line">{message.text}</span>}
      {image && <img src={image} alt="Imagem criada pela IA" className="mt-2 max-h-72 w-full rounded-lg object-contain" />}
      {message.data?.postDraft?.image && <button type="button" onClick={() => onContinueToPost(message.data.postDraft)} className="mt-2 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110">Usar no Meu Post</button>}
      {summary && <pre className="mt-2 whitespace-pre-wrap border-t border-subtle pt-2 text-xs text-zinc-400">{summary}</pre>}
      {message.role === 'agent' && <button type="button" onClick={() => onEdit(editingIndex === index ? null : index)} className="mt-1 block text-[11px] text-gold hover:underline">{editingIndex === index ? 'Concluir edição' : 'Editar resposta'}</button>}
      {message.confirmationToken && <button type="button" onClick={() => onConfirm(message.confirmationToken, index)} className="mt-2 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110">Confirmar ação</button>}
    </div>
  )
}

function AiWidgetPanel({ messages, editingIndex, onEdit, onChangeMessage, sending, processingMessage, error, input, onInputChange, onSend, onConfirm, onClose, messagesRef, onContinueToPost }) {
  return (
    <section role="dialog" aria-label="Assistente de IA" className="flex h-[520px] w-[min(390px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-subtle bg-surface shadow-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <div className="flex items-center gap-2"><RobotAvatar /><div><p className="text-sm font-semibold text-zinc-50">Agente IA</p><p className="text-[11px] text-zinc-500">Entendo os módulos e ações da aplicação</p></div></div>
        <button aria-label="Fechar assistente" onClick={onClose} className="rounded-full p-1.5 text-zinc-500 hover:bg-surface-soft hover:text-zinc-200">✕</button>
      </header>
      <div ref={messagesRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-sm text-zinc-500">Peça para consultar seus posts, gerar ideias ou criar uma imagem. Se quiser publicar a imagem, use o botão para continuar no Meu Post.</p>}
        {messages.map((message, index) => <AgentMessage key={index} message={message} index={index} editingIndex={editingIndex} onEdit={onEdit} onChangeMessage={onChangeMessage} onConfirm={onConfirm} onContinueToPost={onContinueToPost} />)}
        {sending && <div className="max-w-[85%] rounded-lg bg-surface-soft px-3 py-2 text-sm text-zinc-400" aria-live="polite">{processingMessage}</div>}
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      </div>
      <form onSubmit={onSend} className="flex items-center gap-2 border-t border-subtle p-3">
        <input value={input} onChange={onInputChange} placeholder="Digite o que você precisa..." aria-label="Mensagem para o Agente IA" className="flex-1 rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100 outline-none focus:border-gold/50" />
        <button disabled={sending || !input.trim()} className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-black disabled:opacity-40">Enviar</button>
      </form>
    </section>
  )
}

export function AiAssistantWidget({ hidden = false, currentPage = null, onNavigate }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [processingMessage, setProcessingMessage] = useState('')
  const [error, setError] = useState('')
  const [editingIndex, setEditingIndex] = useState(null)
  const [pendingPlan, setPendingPlan] = useState(null)
  const messagesRef = useRef(null)

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages, sending])

  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') setOpen(false) }
    if (open) window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (hidden) return null

  async function send(event) {
    event.preventDefault()
    const text = input.trim()
    if (!text || sending) return
    setInput(''); setError(''); setProcessingMessage(processingMessageFor(text)); setMessages(value => [...value, { role: 'user', text }]); persistMessage('fab', 'user', text); setSending(true)
    try {
      const history = messages.slice(-6).map(({ role, text: content, plan, data }) => ({
        role,
        content,
        action: plan?.actionId || null,
        contexto: summarizeData(data).slice(0, 1500),
      }))
      const data = await apiFetch('/api/ai/agent', { method: 'POST', timeoutMs: AI_REQUEST_TIMEOUT_MS, body: JSON.stringify({ message: text, currentPage, history, pendingPlan }) })
      const reply = data.message || 'Solicitação processada.'
      setMessages(value => [...value, { role: 'agent', text: reply, data: data.data, plan: data.plan || null, confirmationToken: data.confirmationToken || null }])
      setPendingPlan(data.requiresInput ? data.plan : null)
      persistMessage('fab', 'agent', reply)
      if (data.navigation && onNavigate) onNavigate(data.navigation)
    } catch (caught) { setError(friendlyAgentError(caught)) } finally { setSending(false); setProcessingMessage('') }
  }

  async function confirm(token, index) {
    if (sending) return
    setError(''); setProcessingMessage('Estou executando a ação confirmada. Aguarde só mais um momento...'); setSending(true)
    try {
      const data = await apiFetch('/api/ai/agent', { method: 'POST', timeoutMs: AI_REQUEST_TIMEOUT_MS, body: JSON.stringify({ approvalToken: token }) })
      const reply = data.message || 'Ação concluída.'
      setMessages(value => value.map((message, messageIndex) => messageIndex === index ? { ...message, text: `${message.text}\n${reply}`, data: data.data, confirmationToken: null } : message))
      setPendingPlan(null)
      persistMessage('fab', 'agent', reply)
      if (data.navigation && onNavigate) onNavigate(data.navigation)
    } catch (caught) { setError(friendlyAgentError(caught)) } finally { setSending(false); setProcessingMessage('') }
  }

  function continueToPost(postDraft) {
    storeAiPostDraft(postDraft)
    onNavigate?.('agendador')
  }

  return <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
    {open && <AiWidgetPanel messages={messages} editingIndex={editingIndex} onEdit={setEditingIndex} onChangeMessage={(index, text) => setMessages(value => value.map((message, messageIndex) => messageIndex === index ? { ...message, text } : message))} sending={sending} processingMessage={processingMessage} error={error} input={input} onInputChange={event => setInput(event.target.value)} onSend={send} onConfirm={confirm} onClose={() => setOpen(false)} messagesRef={messagesRef} onContinueToPost={continueToPost} />}
    <button onClick={() => setOpen(value => !value)} aria-label={open ? 'Fechar assistente de IA' : 'Abrir assistente de IA'} aria-expanded={open} className="ai-assistant-toggle flex h-14 w-14 items-center justify-center rounded-full bg-gold text-xl text-black shadow-[0_4px_18px_rgba(229,184,66,0.4)] transition-transform hover:scale-105">{open ? '✕' : <RobotAvatar size="large" />}</button>
  </div>
}
