import { useEffect, useRef, useState } from 'react'

// Passos do tour guiado. Cada passo com "page" navega o app de verdade para
// aquela tela enquanto a caixa do tutorial explica o que está sendo mostrado
// — por isso a experiência é a de "caminhar pela aplicação" e não apenas ler
// uma lista de dicas. Passos com "target" (sem "page") destacam um elemento
// fixo do topo do app (ex.: botão de criar post) sem trocar de tela.
// A lista cobre os itens do menu e as ferramentas globais. Além do resumo,
// cada módulo pode trazer uma lista de ações para o tour funcionar como uma
// referência rápida, não apenas como uma apresentação superficial.
// O número "passo X de Y" não é escrito à mão em cada item — é calculado a
// partir da posição no array (ver `stepEyebrow` abaixo), então adicionar,
// remover ou reordenar passos nunca deixa a contagem desatualizada.
const STEPS = [
  {
    eyebrow: 'BEM-VINDO(A)',
    title: 'Vamos conhecer o Meu Ecoo Mídia',
    body: 'Este tour mostra como conectar suas redes, criar conteúdo, organizar a agenda, acompanhar resultados e trabalhar em equipe. Você pode revê-lo quando quiser pelo ícone 🎓 no topo da tela.',
    tips: [
      'Use Próximo para avançar e Voltar para revisar uma etapa.',
      'O tour abre cada tela automaticamente para mostrar onde encontrar os recursos.',
      'No celular, abra Mais para acessar os módulos que não ficam na barra inferior.'
    ]
  },
  {
    page: 'dashboard',
    title: 'Seu painel principal',
    body: 'O Dashboard é o ponto de partida para entender o que precisa da sua atenção e decidir o próximo passo.',
    tips: [
      'Veja totais de publicações, agendamentos, contas conectadas e redes ativas.',
      'Acompanhe visualizações, interações, taxa de interação e tendência por período e rede.',
      'Leia os insights de conteúdo e melhor horário baseados nos dados reais disponíveis.',
      'Busque publicações recentes e filtre entre todas, publicadas, agendadas e com falha.',
      'Revise falhas no editor, corrija a agenda ou abra o Analytics para investigar.'
    ]
  },
  {
    target: 'tema',
    title: 'Ajuste a experiência do app',
    body: 'No topo você encontra preferências e atalhos que deixam a rotina mais rápida e confortável.',
    tips: [
      'Alterne entre os temas Claro e Escuro; a escolha fica salva neste dispositivo.',
      'Use ? para consultar os atalhos de teclado: C cria um post, D abre o Dashboard e Esc fecha janelas.',
      'O ícone de mensagens leva direto ao Inbox.',
      'O sino mostra atualizações recentes de publicações e abre o histórico completo de Atividades.'
    ]
  },
  {
    target: 'criar-post',
    title: 'Crie um post de qualquer tela',
    body: 'O botão + Criar Novo Post permanece no topo do app. Use-o para abrir o Criador de Posts sem voltar ao menu.',
    tips: [
      'Você também pode pressionar C quando não estiver digitando em um campo.',
      'No celular, a ação Criar fica disponível na barra inferior.'
    ]
  },
  {
    page: 'agendador',
    title: 'Criador de Posts: produza e publique',
    body: 'Este é o centro da operação. Monte uma publicação, adapte-a para cada rede, revise a prévia e escolha entre publicar agora ou agendar.',
    tips: [
      'Escolha Instagram, Facebook, YouTube e/ou TikTok e selecione as contas específicas que receberão o post.',
      'Escreva um texto diferente para cada rede e, quando disponível, use título e primeiro comentário.',
      'Envie imagens, vídeos ou fotos para carrossel; arraste arquivos, reorganize a ordem e remova o que não quiser.',
      'Use uma mídia já salva na Biblioteca e confira a prévia realista por rede, formato, proporção e resolução.',
      'Configure opções do Instagram (Feed, Reel ou Story), YouTube (título, categoria, formato e público infantil) e TikTok (privacidade, comentários, duetos e stitches).',
      'No Facebook e Instagram, pesquise e associe um local quando essa opção fizer sentido.',
      'A IA visual pode analisar a imagem ou cenas do vídeo e sugerir descrição, hashtags e texto por rede.',
      'Salve como rascunho/modelo, acompanhe o progresso e use o painel de pendências antes de publicar ou agendar.'
    ]
  },
  {
    page: 'calendario',
    title: 'Calendário: organize a agenda',
    body: 'Visualize seu planejamento editorial e ajuste publicações sem precisar recriar o conteúdo.',
    tips: [
      'Navegue entre meses, volte para Hoje e filtre o calendário por rede social.',
      'Alterne entre a visualização de calendário e lista.',
      'Abra um dia para ver texto, plataformas, mídia e status de cada publicação.',
      'Edite data e horário ou arraste um agendamento para outro dia.',
      'Copie um agendamento para criar uma nova publicação e use Reagendar para repetir um post publicado.',
      'Exclua um agendamento antes do envio ou remova do calendário um post já publicado; isso não apaga a publicação da rede social.'
    ]
  },
  {
    page: 'rascunhos',
    title: 'Baú de Ideias: não perca trabalhos em andamento',
    body: 'Guarde conteúdos incompletos, ideias rápidas e publicações que precisam de revisão antes de voltar ao Criador de Posts.',
    tips: [
      'Crie um rascunho rápido apenas com texto para registrar uma ideia.',
      'Busque por texto ou título e filtre por plataforma e tipo.',
      'Veja as mídias associadas, reabra o conteúdo no editor e continue de onde parou.',
      'Exclua rascunhos que não fazem mais sentido.'
    ]
  },
  {
    page: 'analytics',
    title: 'Relatórios: transforme métricas em decisões',
    body: 'Consulte os dados reais das redes conectadas em uma visão executiva e em relatórios detalhados por conta e publicação.',
    tips: [
      'Escolha a rede, a aba de comunidade, conteúdo ou audiência e um período de 7, 30 ou 90 dias.',
      'Compare períodos quando essa opção estiver disponível e acompanhe visualizações, curtidas, comentários, compartilhamentos e salvamentos.',
      'Analise crescimento de seguidores/inscritos, evolução diária, melhores horários, decadência de conteúdo e demografia quando a rede fornecer esses dados.',
      'Abra o relatório detalhado de uma conta e consulte os vídeos do TikTok.',
      'Exporte o recorte atual em CSV ou gere uma versão para imprimir/salvar em PDF.',
      'Configure relatórios agendados por e-mail; os dados são atualizados automaticamente enquanto a tela está visível.'
    ]
  },
  {
    page: 'inbox',
    title: 'Inbox: cuide da sua comunidade',
    body: 'Concentre as publicações com interações e responda aos comentários sem alternar entre várias redes.',
    tips: [
      'Monitore Instagram, Facebook e YouTube e veja quantos comentários não lidos pedem atenção.',
      'Pesquise uma publicação e filtre por rede ou por não lidos/já lidos.',
      'Selecione uma ou várias publicações e marque os comentários como vistos.',
      'Abra a conversa para visualizar a mídia, ler os comentários e responder quando a plataforma permitir.',
      'Seus filtros ficam salvos neste dispositivo para a próxima visita.'
    ]
  },
  {
    target: 'notificacoes',
    title: 'Notificações e acompanhamento',
    body: 'O sino reúne atualizações recentes para você perceber rapidamente quando uma publicação foi concluída, está processando ou precisa de atenção.',
    tips: [
      'Veja sucessos, pendências, alertas e falhas de publicação no popover do topo.',
      'Use Ver histórico completo para consultar a Central de Atividades.'
    ]
  },
  {
    page: 'integracoes',
    title: 'Contas conectadas: ligue suas redes',
    body: 'Conecte as contas que você administra para liberar publicação, comentários e métricas dentro do Meu Ecoo Mídia.',
    tips: [
      'Conecte Instagram, Facebook, YouTube e TikTok por autorização segura.',
      'Adicione mais de uma conta da mesma rede e pesquise a conta que precisa encontrar.',
      'Filtre por situação do token, reconecte contas expiradas e consulte a saúde operacional das APIs.',
      'Abra o perfil público quando houver endereço disponível ou desconecte uma conta que não usa mais.',
      'Quando o problema for credencial, vá direto para Tokens.'
    ]
  },
  {
    page: 'tokens',
    title: 'Tokens: mantenha as autorizações saudáveis',
    body: 'Tenha visibilidade sobre as credenciais das contas conectadas sem expor o segredo completo.',
    tips: [
      'Busque por conta ou rede e filtre por plataforma.',
      'Filtre tokens válidos, expirando, expirados ou com erro.',
      'Renove uma credencial individual ou use Renovar todos para corrigir várias de uma vez.',
      'Confira última utilização e vencimento e revogue tokens que não devem mais ser usados.'
    ]
  },
  {
    page: 'seguranca',
    title: 'Segurança: proteja seu acesso',
    body: 'Adicione uma camada extra ao login com autenticação em dois fatores (2FA).',
    tips: [
      'Inicie a configuração informando sua senha atual.',
      'Escaneie o QR Code no Google Authenticator, Authy ou outro app compatível; também é possível usar a chave manual.',
      'Confirme o código de seis dígitos para ativar a proteção.',
      'Para desativar o 2FA, informe um código atual do autenticador.'
    ]
  },
  {
    page: 'atividade',
    title: 'Atividades: acompanhe tudo o que aconteceu',
    body: 'A Central de Atividades é o histórico operacional da sua conta e ajuda a investigar publicações, conexões e alterações.',
    tips: [
      'Consulte até 200 eventos recentes em ordem cronológica.',
      'Filtre por sucesso, erro ou informação e pesquise uma mensagem específica.',
      'Atualize a lista para buscar os eventos mais recentes.',
      'Limpe todo o histórico somente depois de confirmar a ação.'
    ]
  },
  {
    page: 'ai',
    title: 'Assistente IA: planeje, crie e aprenda',
    body: 'Descreva o que quer publicar e use a IA para gerar ideias, imagens e leituras práticas do seu desempenho.',
    tips: [
      'Informe um tema e gere até três sugestões; depois peça mais ideias sem apagar as anteriores.',
      'Escolha o modelo disponível, edite o texto e gere uma imagem única ou um carrossel de 3 a 8 slides para Instagram.',
      'Escolha a rede e a conta compatível para publicar a sugestão; o YouTube exige mídia de vídeo.',
      'Acompanhe o status da publicação e consulte o diagnóstico das execuções do agente.',
      'Analise os últimos 7, 30 ou 90 dias para descobrir melhor horário, período do dia, perfis e nichos com melhor sinal.',
      'Use as recomendações como apoio: a IA trabalha com os dados reais disponíveis e o limite depende do seu plano.'
    ]
  },
  {
    page: 'biblioteca',
    title: 'Biblioteca: organize seu acervo',
    body: 'Centralize imagens e vídeos reutilizáveis para deixar a criação mais rápida e o material da marca mais organizado.',
    tips: [
      'Crie pastas, escolha o destino do upload e envie arquivos para o seu acervo.',
      'Busque por nome e filtre por pasta; veja prévias, tamanho e tags.',
      'Use uma mídia diretamente no Criador de Posts ou remova arquivos que não precisa mais.',
      'Peça à IA sugestões de conteúdo com base em nicho, período, redes escolhidas e seus Analytics.',
      'Salve uma sugestão no Baú de Ideias para desenvolver depois.'
    ]
  },
  {
    page: 'filas',
    title: 'Repetidor de posts: automatize rotinas',
    body: 'Crie uma fila recorrente para transformar um conteúdo em uma rotina de publicação nos dias e horários escolhidos.',
    tips: [
      'Dê um nome à fila, escreva o conteúdo e escolha as redes que participarão.',
      'Defina um ou mais dias da semana e o horário de execução.',
      'Inclua mídia quando necessário e confira a próxima execução.',
      'Ative, pause ou exclua uma fila a qualquer momento.'
    ]
  },
  {
    page: 'smartlinks',
    title: 'Smartlinks: um endereço para todos os seus links',
    body: 'Monte uma página pública para sua bio com os destinos mais importantes da marca e acompanhe os cliques.',
    tips: [
      'Defina nome interno, título, descrição e logo da página.',
      'Cadastre links no formato texto | URL e organize seus canais, produtos ou campanhas.',
      'Abra a página pública e copie o endereço /go/slug para usar na bio.',
      'Edite o slug/URL, acompanhe cliques por link e exclua páginas que não usa mais.'
    ]
  },
  {
    page: 'equipe',
    title: 'Equipe: colabore com aprovação',
    body: 'Separe operações por cliente ou marca e mantenha um fluxo claro de colaboração antes do envio às redes.',
    tips: [
      'Crie e selecione espaços de trabalho para cada cliente, marca ou projeto.',
      'Adicione colaboradores já cadastrados e defina Editor, Aprovador ou Administrador.',
      'Escolha uma publicação e envie uma solicitação para revisão.',
      'Acompanhe solicitações pendentes e aprove ou rejeite o conteúdo.',
      'Personalize o nome exibido e a cor da identidade visual do espaço.'
    ]
  },
  {
    page: 'perfil',
    title: 'Perfil, preferências e plano',
    body: 'Use seu perfil para manter seus dados e preferências em dia, controlar a sessão e entender o que está disponível no seu plano.',
    tips: [
      'Altere nome, avatar, fuso horário, idioma e plataforma padrão.',
      'Escolha quais notificações receber por e-mail: publicações, falhas e comentários.',
      'Troque sua senha, encerre a sessão atual ou saia de todos os dispositivos.',
      'Consulte o uso de IA, compare os planos e escolha um plano pelo checkout seguro.',
      'Acesse rapidamente Contas, Tokens e Atividades.',
      'Aqui você pode iniciar ou rever este tutorial guiado.'
    ]
  },
  {
    target: 'administracao',
    title: 'Administração (quando disponível)',
    body: 'Administradores encontram aqui os controles da plataforma para acompanhar e manter as contas de usuários.',
    tips: [
      'Consulte e pesquise usuários, papéis, situação e quantidade de contas conectadas.',
      'Promova ou rebaixe administradores respeitando as regras de segurança.',
      'Ative ou desative usuários; a própria conta do administrador não pode ser desativada.',
      'Este menu aparece somente para quem possui permissão de administrador.'
    ]
  },
  {
    eyebrow: 'TUDO PRONTO',
    title: 'Você já conhece toda a plataforma! 🎉',
    body: 'Um fluxo recomendado é: conecte suas contas, publique ou agende um primeiro conteúdo, acompanhe o resultado no Analytics e use a IA para planejar o próximo teste. O tutorial fica sempre disponível pelo ícone 🎓 ou em Perfil.',
    tips: [
      'Comece conectando as redes que deseja administrar.',
      'Use o Criador de Posts para publicar agora, agendar, salvar um rascunho ou criar um modelo.',
      'Volte ao Calendário, Inbox e Relatórios para acompanhar a operação.',
      'Se precisar de ajuda, consulte o tutorial novamente ou abra o Suporte no rodapé do Perfil.'
    ],
    final: true
  }
]

// "Passos com conteúdo" são os que ficam entre a boas-vindas e a conclusão
// — é essa contagem que aparece como "PASSO N DE M" para a pessoa.
function stepEyebrow(step, index) {
  if (step.eyebrow) return step.eyebrow
  return `PASSO ${index} DE ${STEPS.length - 2}`
}

// Páginas cujo destaque é alcançável no mobile sem abrir a barra lateral
// (menu inferior ou barra superior, que ficam sempre visíveis). Todo o
// resto só existe no menu lateral, então precisa que ele seja aberto.
const MOBILE_REACHABLE_PAGES = new Set(['dashboard', 'agendador', 'calendario', 'inbox', 'perfil'])

function stepNeedsMobileSidebar(step) {
  if (!step) return false
  if (step.target) return step.target === 'administracao'
  return Boolean(step.page) && !MOBILE_REACHABLE_PAGES.has(step.page)
}

// No mobile, o item destacado por um passo fica sempre perto do topo da tela
// (menu lateral aberto ou barra superior) — exceto os 4 itens que também
// vivem no menu inferior fixo. Por isso a caixa do tutorial "encosta" no
// lado oposto ao do destaque: sobe para o topo quando o alvo é o menu
// inferior, e vira uma folha (sheet) colada embaixo nos demais casos — assim
// ela nunca cobre o próprio elemento que está apresentando.
const BOTTOM_NAV_PAGES = new Set(['dashboard', 'agendador', 'calendario', 'inbox'])

function stepSpotlightsMobileBottomNav(step) {
  return Boolean(step?.page) && !step.target && BOTTOM_NAV_PAGES.has(step.page)
}

// Procura, entre todos os elementos marcados com esse alvo (menu lateral,
// menu inferior no mobile ou ações fixas do topo), o primeiro que está de
// fato visível na tela — no mobile a barra lateral fica fora da tela, então
// é ignorada.
function findVisibleTarget(target) {
  if (!target || typeof document === 'undefined') return null
  const candidates = document.querySelectorAll(`[data-tutorial-target="${target}"]`)
  for (const el of candidates) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && rect.left > -rect.width && rect.left < window.innerWidth) {
      return rect
    }
  }
  return null
}

export function AppTutorial({ open, onNavigate, onClose, onComplete, onRequestSidebar }) {
  const [index, setIndex] = useState(0)
  const [spotlightRect, setSpotlightRect] = useState(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  // Trava o scroll da página por trás enquanto o tour está aberto, já que a
  // navegação entre telas durante os passos pode deixar a posição do scroll
  // inconsistente assim que o overlay some.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  // Move o foco para o diálogo a cada passo, tanto para leitores de tela
  // anunciarem o novo conteúdo quanto para quem navega só pelo teclado.
  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open, index])

  useEffect(() => {
    if (!open) {
      onRequestSidebar?.(false)
      return
    }
    const step = STEPS[index]
    if (step.page) onNavigate?.(step.page)
    onRequestSidebar?.(stepNeedsMobileSidebar(step))
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
      setSpotlightRect(findVisibleTarget(step.target || step.page))
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
      if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); goNext() }
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
  const overlayClassName = [
    'tutorial-overlay',
    spotlightRect ? 'has-spotlight' : '',
    stepSpotlightsMobileBottomNav(step) ? 'spotlight-near-bottom' : ''
  ].filter(Boolean).join(' ')

  return <div className={overlayClassName} role="presentation" onMouseDown={onClose}>
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
      ref={dialogRef}
      className="tutorial-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      tabIndex="-1"
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="tutorial-heading" aria-live="polite">
        <div>
          <p className="eyebrow">{stepEyebrow(step, index)}</p>
          <h2 id="tutorial-title">{step.title}</h2>
        </div>
        <button type="button" className="tutorial-close" onClick={onClose} aria-label="Fechar tutorial">✕</button>
      </div>

      <p className="tutorial-body" aria-live="polite">{step.body}</p>

      {step.tips?.length > 0 && <ul className="tutorial-features" aria-label="O que você pode fazer nesta área">
        {step.tips.map(tip => <li key={tip}><span aria-hidden="true">✓</span><span>{tip}</span></li>)}
      </ul>}

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
