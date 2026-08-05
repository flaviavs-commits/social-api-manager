import { useState } from 'react'
import { AiAssistantWidget } from '../ai/ai-assistant-widget.jsx'
import { logout } from '../../lib/api.js'

const icons = {
  dashboard: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 7h7v9h-7v-9ZM4 14h7v6H4v-6Z',
  agendador: 'M4 20h4.2L18.8 9.4l-4.2-4.2L4.4 15.8 4 20Zm12.5-14.7 2.2 2.2 1.6-1.6a1.5 1.5 0 0 0 0-2.1l-.1-.1a1.5 1.5 0 0 0-2.1 0l-1.6 1.6Z',
  calendario: 'M7 2v3M17 2v3M3.5 8.5h17M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 7h3v3H7v-3Z',
  rascunhos: 'M6 2h9l3 3v17H6V2Zm8 1v4h4M9 12h6M9 15.5h6M9 8.5h3',
  analytics: 'M4 20V10M10 20V4M16 20v-7M22 20v-3',
  inbox: 'M3 5h18l-1.5 12a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8L3 5Zm0 0 2.5 7h13L21 5M9.5 12h5',
  integracoes: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-7 9a7 7 0 0 1 14 0',
  tokens: 'M15 7a4 4 0 1 1-4 4H4v2h2v3h3v-3h2.06A4 4 0 0 0 15 7Zm0-2a6 6 0 1 1-5.92 7H7v3H4v-3H2v-4h7.08A6 6 0 0 1 15 5Z',
  ai: 'M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Zm7 12 .8 2.6L22.4 17.4 19.8 18.2 19 20.8 18.2 18.2 15.6 17.4 18.2 16.6 19 14Z'
}

const navigation = [
  ['dashboard', 'Dashboard'],
  ['agendador', 'Criador de Posts'],
  ['calendario', 'Calendário'],
  ['rascunhos', 'Rascunhos'],
  ['analytics', 'Relatórios'],
  ['inbox', 'Inbox'],
  ['integracoes', 'Contas'],
  ['tokens', 'Tokens'],
  ['ai', 'Assistente IA']
]

function NavIcon({ name, className = 'h-[18px] w-[18px]' }) {
  const d = icons[name]
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function AppSidebar({ page, open, onNavigate, onClose }) {
  return (
    <>
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-subtle bg-surface transition-transform duration-200 md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <a href="/" aria-label="Meu Ecoo Mídia - início" className="group flex flex-col gap-2 border-b border-subtle px-5 py-5">
        <img src="/logo.svg" alt="Meu Ecoo Mídia" className="h-14 w-auto" />
        <p className="truncate text-[11px] leading-tight text-zinc-500">Conecte. Crie. Agende. Cresça.</p>
      </a>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navigation.map(([key, label]) => {
          const active = page === key
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className={`group flex items-center justify-between rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-gold bg-gold/10 text-gold'
                  : 'border-transparent text-zinc-400 hover:bg-surface-soft hover:text-zinc-100'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <NavIcon name={key} />
                {label}
              </span>
              {active && (
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-500">
                  Ativo
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <button
        onClick={logout}
        className="mx-3 mb-5 rounded-lg border border-subtle px-3 py-2.5 text-left text-sm font-medium text-zinc-400 transition-colors hover:border-gold/40 hover:text-gold"
      >
        Sair
      </button>
    </aside>
    {open && <button aria-label="Fechar menu" onClick={onClose} className="fixed inset-0 z-30 bg-black/60 md:hidden" />}
    </>
  )
}

function AppTopbar({ currentLabel, user, onOpenSidebar, onCreatePost }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-subtle bg-app px-6 py-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          aria-label="Abrir menu"
          className="rounded-lg border border-subtle p-2 text-zinc-400 hover:text-gold md:hidden"
        >
          ☰
        </button>
        <nav aria-label="Localização atual" className="flex items-center gap-2 text-xl font-semibold text-zinc-50">
          <img src="/favicon.svg" alt="" className="hidden h-6 w-6 sm:block" />
          <span className="hidden text-zinc-400 sm:inline">Meu Ecoo Mídia</span>
          <span className="text-zinc-600">›</span>
          <span className="text-gold">{currentLabel}</span>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <button aria-label="Mensagens" className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-surface-soft hover:text-gold">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9Z"/></svg>
        </button>
        <button aria-label="Notificações" className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-surface-soft hover:text-gold">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/></svg>
        </button>
        <button
          onClick={onCreatePost}
          className="inline-flex items-center gap-2 rounded-lg border border-gold bg-transparent px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/10"
        >
          + Criar Novo Post
        </button>
        <span className="flex items-center gap-2 rounded-full border border-subtle bg-surface py-1 pl-1.5 pr-3 text-sm text-zinc-300">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-soft text-xs">👤</span>
          {user?.name || user?.email || 'Conta'}
        </span>
      </div>
    </header>
  )
}

export function AppShell({ page, onPageChange, children, user }) {
  const [open, setOpen] = useState(false)
  const currentLabel = navigation.find(([key]) => key === page)?.[1] || 'Dashboard'

  return (
    <div className="flex min-h-screen bg-app text-zinc-100">
      <AppSidebar page={page} open={open} onNavigate={key => { onPageChange(key); setOpen(false) }} onClose={() => setOpen(false)} />

      <div className="flex min-h-screen flex-1 flex-col">
        <AppTopbar currentLabel={currentLabel} user={user} onOpenSidebar={() => setOpen(v => !v)} onCreatePost={() => onPageChange('agendador')} />
        <main className="flex-1">{children}</main>
      </div>

      <AiAssistantWidget currentPage={page} onNavigate={onPageChange} />
    </div>
  )
}
