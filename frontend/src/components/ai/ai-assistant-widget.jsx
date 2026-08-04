import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api.js'

// Widget flutuante do Agente IA — mora fora do fluxo de qualquer página
// (montado uma única vez em AppShell) para ficar disponível em toda a
// aplicação sem interferir no estado ou na navegação de nenhuma tela.
// Reaproveita os endpoints já usados pela página "Assistente IA"
// (ver pages/ai-page.jsx): POST /api/ai/generate para gerar sugestões e
// POST /api/ai/chat-messages para persistir o histórico — nenhuma rota
// nova foi necessária no backend.
function persistMessage(contexto, role, conteudo) {
  apiFetch('/api/ai/chat-messages', { method: 'POST', body: JSON.stringify({ contexto, role, conteudo }) }).catch(() => {})
}

function AiWidgetPanel({ messages, editingIndex, onEdit, onChangeMessage, sending, error, input, onInputChange, onSend, onClose, messagesRef }) {
  return (
    <section
      role="dialog"
      aria-label="Assistente de IA"
      className="flex h-[440px] w-[min(360px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-subtle bg-surface shadow-2xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/15 text-gold">✨</span>
          <div>
            <p className="text-sm font-semibold text-zinc-50">Agente IA</p>
            <p className="text-[11px] text-zinc-500">Ideias de posts em segundos</p>
          </div>
        </div>
        <button aria-label="Fechar assistente" onClick={onClose} className="rounded-full p-1.5 text-zinc-500 hover:bg-surface-soft hover:text-zinc-200">
          ✕
        </button>
      </header>

      <div ref={messagesRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Peça uma ideia de publicação, ex.: "crie um post sobre promoção de fim de ano".
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug ${
              message.role === 'user' ? 'ml-auto bg-gold/15 text-zinc-100' : 'bg-surface-soft text-zinc-200'
            }`}
          >
            {message.role === 'agent' && editingIndex === index
              ? <textarea value={message.text} onChange={event => onChangeMessage(index, event.target.value)} aria-label="Editar resposta da IA" className="w-full rounded border border-subtle bg-app p-2 text-sm text-zinc-100" />
              : message.text}
            {message.role === 'agent' && <button type="button" onClick={() => onEdit(editingIndex === index ? null : index)} className="mt-1 block text-[11px] text-gold hover:underline">{editingIndex === index ? 'Concluir edição' : 'Editar texto'}</button>}
          </div>
        ))}
        {sending && <div className="max-w-[85%] rounded-lg bg-surface-soft px-3 py-2 text-sm text-zinc-400">Gerando ideia...</div>}
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      </div>

      <form onSubmit={onSend} className="flex items-center gap-2 border-t border-subtle p-3">
        <input
          value={input}
          onChange={onInputChange}
          placeholder="Digite sua mensagem..."
          aria-label="Mensagem para o Agente IA"
          className="flex-1 rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100 outline-none focus:border-gold/50"
        />
        <button
          disabled={sending || !input.trim()}
          className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          Enviar
        </button>
      </form>
    </section>
  )
}

export function AiAssistantWidget({ hidden = false }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [editingIndex, setEditingIndex] = useState(null)
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
    setInput('')
    setError('')
    setMessages(value => [...value, { role: 'user', text }])
    persistMessage('fab', 'user', text)
    setSending(true)
    try {
      const data = await apiFetch('/api/ai/generate', { method: 'POST', body: JSON.stringify({ instrucao: text, plataformas: ['instagram'], quantidade: 1, tom: 'profissional' }) })
      const reply = data.posts?.[0]?.text || data.posts?.[0]?.caption || 'Não consegui gerar uma sugestão agora. Tente reformular o pedido.'
      setMessages(value => [...value, { role: 'agent', text: reply }])
      persistMessage('fab', 'agent', reply)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
      <AiWidgetPanel
          messages={messages}
          editingIndex={editingIndex}
          onEdit={setEditingIndex}
          onChangeMessage={(index, text) => setMessages(value => value.map((message, messageIndex) => messageIndex === index ? { ...message, text } : message))}
          sending={sending}
          error={error}
          input={input}
          onInputChange={event => setInput(event.target.value)}
          onSend={send}
          onClose={() => setOpen(false)}
          messagesRef={messagesRef}
        />
      )}

      <button
        onClick={() => setOpen(value => !value)}
        aria-label={open ? 'Fechar assistente de IA' : 'Abrir assistente de IA'}
        aria-expanded={open}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-xl text-black shadow-[0_4px_18px_rgba(229,184,66,0.4)] transition-transform hover:scale-105"
      >
        {open ? '✕' : '✨'}
      </button>
    </div>
  )
}
