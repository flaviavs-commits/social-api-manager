import { useEffect, useState } from 'react'

// Passos do tour guiado. Cada passo com "page" navega o app de verdade para
// aquela tela enquanto a caixa do tutorial explica o que está sendo mostrado
// — por isso a experiência é a de "caminhar pela aplicação" e não apenas ler
// uma lista de dicas.
const STEPS = [
  {
    eyebrow: 'BEM-VINDO(A)',
    title: 'Vamos conhecer o Meu Ecoo Mídia',
    body: 'Este tour rápido mostra as principais áreas da plataforma, uma de cada vez. Leva menos de 2 minutos e você pode revê-lo quando quiser.'
  },
  {
    page: 'dashboard',
    eyebrow: 'PASSO 1',
    title: 'Seu painel principal',
    body: 'O Dashboard reúne publicações, agendamentos, falhas recentes e quantas redes sociais já estão conectadas — sua visão geral do dia a dia.'
  },
  {
    page: 'agendador',
    eyebrow: 'PASSO 2',
    title: 'Criador de Posts',
    body: 'Escreva o conteúdo, anexe fotos ou vídeos e escolha em quais redes publicar. Você pode publicar na hora ou agendar para o melhor momento.'
  },
  {
    page: 'calendario',
    eyebrow: 'PASSO 3',
    title: 'Calendário',
    body: 'Veja tudo o que está agendado ou já foi publicado, organizado por dia, semana ou mês, para nunca perder o ritmo das postagens.'
  },
  {
    page: 'rascunhos',
    eyebrow: 'PASSO 4',
    title: 'Rascunhos',
    body: 'Ideias que ainda não estão prontas ficam salvas aqui, sem se perder, até você decidir publicar ou agendar.'
  },
  {
    page: 'biblioteca',
    eyebrow: 'PASSO 5',
    title: 'Biblioteca de mídia',
    body: 'Centralize fotos e vídeos já enviados para reutilizar em novas publicações sem precisar subir os arquivos de novo.'
  },
  {
    page: 'analytics',
    eyebrow: 'PASSO 6',
    title: 'Relatórios',
    body: 'Acompanhe alcance, engajamento e o desempenho de cada publicação, separado por rede social.'
  },
  {
    page: 'inbox',
    eyebrow: 'PASSO 7',
    title: 'Inbox',
    body: 'Comentários e mensagens das suas redes conectadas chegam até aqui, para você responder sem sair da plataforma.'
  },
  {
    page: 'integracoes',
    eyebrow: 'PASSO 8',
    title: 'Contas conectadas',
    body: 'Conecte Instagram, Facebook, YouTube e TikTok por aqui — é o primeiro passo para publicar direto pela plataforma.'
  },
  {
    page: 'ai',
    eyebrow: 'PASSO 9',
    title: 'Assistente de IA',
    body: 'Peça legendas, ideias de conteúdo e sugestões de horário de publicação para o Assistente de IA a qualquer momento.'
  },
  {
    page: 'seguranca',
    eyebrow: 'PASSO 10',
    title: 'Segurança',
    body: 'Ative a autenticação em dois fatores e acompanhe as sessões ativas da sua conta por aqui.'
  },
  {
    page: 'perfil',
    eyebrow: 'PASSO 11',
    title: 'Seu perfil',
    body: 'Atualize seus dados, preferências de notificação e veja seu plano de uso. É também aqui que você encontra este tutorial para rever quando quiser.'
  },
  {
    eyebrow: 'TUDO PRONTO',
    title: 'Você já conhece o essencial! 🎉',
    body: 'Agora é só começar a criar. Se precisar rever qualquer passo, o tutorial fica sempre disponível pelo ícone de tutorial no topo da tela.',
    final: true
  }
]

// Procura, entre todos os elementos marcados com esse "page" (menu lateral
// e menu inferior no mobile), o primeiro que está de fato visível na tela —
// no mobile a barra lateral fica fora da tela, então é ignorada.
function findVisibleTarget(page) {
  if (!page || typeof document === 'undefined') return null
  const candidates = document.querySelectorAll(`[data-tutorial-target="${page}"]`)
  for (const el of candidates) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && rect.left > -rect.width && rect.left < window.innerWidth) {
      return rect
    }
  }
  return null
}

export function AppTutorial({ open, onNavigate, onClose, onComplete }) {
  const [index, setIndex] = useState(0)
  const [spotlightRect, setSpotlightRect] = useState(null)

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const step = STEPS[index]
    if (step.page) onNavigate?.(step.page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index])

  // Localiza e acompanha o item do menu correspondente ao passo atual, para
  // desenhar o destaque em volta dele enquanto o resto da tela escurece.
  useEffect(() => {
    if (!open) {
      setSpotlightRect(null)
      return
    }
    const step = STEPS[index]
    function updateRect() {
      setSpotlightRect(findVisibleTarget(step.page))
    }
    updateRect()
    // Recalcula depois do próximo frame, já que a navegação para a página do
    // passo pode mudar o layout (ex.: recolher a sidebar).
    const raf = window.requestAnimationFrame(updateRect)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [open, index])

  useEffect(() => {
    if (!open) return
    function handleKeydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'ArrowRight') { event.preventDefault(); goNext() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); goBack() }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index])

  if (!open) return null

  const step = STEPS[index]
  const isFirst = index === 0
  const isLast = index === STEPS.length - 1

  function goNext() {
    if (isLast) return onComplete()
    setIndex(current => Math.min(current + 1, STEPS.length - 1))
  }

  function goBack() {
    setIndex(current => Math.max(current - 1, 0))
  }

  const spotlightPadding = 8

  return <div className={`tutorial-overlay${spotlightRect ? ' has-spotlight' : ''}`} role="presentation" onMouseDown={onClose}>
    {spotlightRect && (
      <div
        className="tutorial-spotlight"
        aria-hidden="true"
        style={{
          top: spotlightRect.top - spotlightPadding,
          left: spotlightRect.left - spotlightPadding,
          width: spotlightRect.width + spotlightPadding * 2,
          height: spotlightRect.height + spotlightPadding * 2
        }}
      />
    )}
    <section
      className="tutorial-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="tutorial-heading">
        <div>
          <p className="eyebrow">{step.eyebrow}</p>
          <h2 id="tutorial-title">{step.title}</h2>
        </div>
        <button type="button" className="tutorial-close" onClick={onClose} aria-label="Fechar tutorial">✕</button>
      </div>

      <p className="tutorial-body">{step.body}</p>

      <div className="tutorial-progress" aria-label={`Passo ${index + 1} de ${STEPS.length}`}>
        <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
      </div>

      <div className="tutorial-footer">
        <span className="tutorial-step-counter">{index + 1} de {STEPS.length}</span>
        <div className="tutorial-nav-buttons">
          <button type="button" className="link-button" onClick={onClose}>{isLast ? 'Fechar' : 'Pular tutorial'}</button>
          {!isFirst && <button type="button" className="secondary-button" onClick={goBack}>Voltar</button>}
          <button type="button" className="action-button" onClick={goNext}>{isLast ? 'Concluir tutorial' : 'Próximo'}</button>
        </div>
      </div>
    </section>
  </div>
}
