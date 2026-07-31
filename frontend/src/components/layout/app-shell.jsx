import { useState } from 'react'

const navigation = [
  ['dashboard', 'Visão geral'],
  ['agendador', 'Novo post'],
  ['calendario', 'Calendário'],
  ['rascunhos', 'Rascunhos'],
  ['analytics', 'Analytics'],
  ['inbox', 'Inbox'],
  ['integracoes', 'Contas conectadas'],
  ['tokens', 'Tokens'],
  ['ai', 'Assistente IA']
]

export function AppShell({ page, onPageChange, children, user }) {
  const [open, setOpen] = useState(false)
  const currentLabel = navigation.find(([key]) => key === page)?.[1] || 'Visão geral'

  return (
    <div className="flex min-h-screen bg-app text-zinc-100">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-subtle bg-surface transition-transform duration-200 md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="font-semibold text-zinc-100">Meu Ecoo Mídia</span>
        </div>

        <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 px-3">
          {navigation.map(([key, label]) => {
            const active = page === key
            return (
              <button
                key={key}
                onClick={() => { onPageChange(key); setOpen(false) }}
                className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-l-2 border-gold bg-gold/10 text-gold'
                    : 'border-l-2 border-transparent text-zinc-400 hover:bg-surface-soft hover:text-zinc-100'
                }`}
              >
                <span>{label}</span>
                {key === 'calendario' && (
                  <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-500">
                    ativo
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <button
          onClick={() => { localStorage.removeItem('authToken'); window.location.href = '/login.html' }}
          className="mx-3 mb-5 rounded-lg border border-subtle px-3 py-2.5 text-left text-sm font-medium text-zinc-400 transition-colors hover:border-gold/40 hover:text-gold"
        >
          Sair
        </button>
      </aside>

      {open && (
        <button
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-subtle bg-app px-6 py-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(v => !v)}
              aria-label="Abrir menu"
              className="rounded-lg border border-subtle p-2 text-zinc-400 hover:text-gold md:hidden"
            >
              ☰
            </button>
            <div>
              <p className="text-[11px] font-bold tracking-[0.1em] text-gold-muted">PAINEL DE CONTROLE</p>
              <h1 className="text-xl font-semibold text-zinc-50">{currentLabel}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onPageChange('agendador')}
              className="inline-flex items-center gap-2 rounded-lg border border-gold bg-transparent px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/10"
            >
              + Criar novo post
            </button>
            <span className="rounded-full border border-subtle bg-surface px-3 py-1.5 text-sm text-zinc-300">
              {user?.name || user?.email || 'Conta'}
            </span>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
