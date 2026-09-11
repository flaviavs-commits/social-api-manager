# Ecoo Mídia — narrativa contínua de recursos

Implementação local em `#recursos`, na landing. A hero, o formulário de entrada, os planos, as rotas, as APIs e a seção posterior `#como-funciona` não foram reconstruídos nesta passagem.

## Direção visual

Um único `HeroContentObject` permanece montado durante todo o percurso. É um post editorial com a **logo real do repositório e a copy já usada na landing**, construído em HTML/CSS. Nada de fotografias geradas, cafeteria, marcas fictícias, depoimentos, comentários inventados ou métricas numéricas simuladas.

Os seis textos originais permanecem integrais. A ordem visual é: Agendamento → Criação assistida → Reaproveitamento → Caixa de entrada → Link na bio → Relatórios. Publicação e conexão às quatro redes fazem parte da passagem do mesmo post entre esses recursos. A mudança de ordem coloca o relatório no encerramento sem eliminar Caixa de entrada ou Link na bio para criar funções novas.

A identidade continua creme, dourado e carvão. As cores próprias de Instagram, Facebook, TikTok e YouTube ficam restritas aos quatro nós sociais. Calendário, editor, biblioteca, comentários e gráfico são **prévias ilustrativas**, não dados de uma conta. No gráfico não há valores, percentuais nem promessa de resultado.

## Arquitetura e arquivos

- `frontend/src/components/marketing/product-story.jsx`: post persistente, cenários funcionais, SVG das conexões, marcadores acessíveis e controlador de scroll.
- `frontend/src/components/marketing/story-progress.js`: interpolação e coreografia como funções puras, testáveis sem browser.
- `frontend/src/components/marketing/story-atmosphere.jsx`: placas estáticas de luz e planos distantes/próximos do percurso.
- `frontend/src/styles/product-story.css`: composição, materiais, profundidade, responsividade e foco.
- `frontend/src/styles/story-environment.css`: atmosfera e deslocamentos de câmera.

Não foi adicionada dependência, biblioteca de animação, vídeo ou imagem nova. A logo existente é reutilizada.

## Scroll e coreografia

Uma única progressão normalizada deriva da posição da seção e do espaço restante até o sticky liberar. Descer avança, subir retrocede, parar congela o quadro. Não há autoplay, timers, loops de flutuação, interceptação de wheel ou inércia acumulada. A bolinha começa a acompanhar o scroll imediatamente, sem um prólogo em que permaneça parada.

Quatro planos se deslocam em velocidades diferentes: ambiente distante, estrutura intermediária, produto e passagem próxima. Luz, tamanho do post, posição, profundidade, texto, desenho das conexões e gráfico usam a mesma progressão. O momento entre biblioteca e publicação aproxima o post do centro, afasta os cenários secundários e permite que o produto oculte fisicamente o eixo.

Cada recurso tem uma faixa de leitura nítida. No crossover não existem dois títulos legíveis simultaneamente. O post não desaparece nem é substituído por outra imagem. Suas camadas se separam no editor e voltam a se encaixar. A última cena permanece completa e sai junto com o sticky, sem remoção condicional ou salto.

O motor usa refs e um único `requestAnimationFrame` solicitado por eventos passivos. React atualiza somente quando muda a etapa. Medidas são coletadas em resize, não repetidas para cada objeto a cada pixel. Frames com o mesmo progresso são ignorados. Não usar estado React por frame nem adicionar triggers independentes.

`transform-style: flat` no plano compartilhado evita a interpenetração entre cenários; o interior do post mantém `preserve-3d`. Isso é intencional: colocar todos os painéis no mesmo contexto 3D provocava recortes triangulares no celular.

## Materiais e responsividade

Tokens locais: `--story-radius`, `--story-perspective`, `--story-paper`, `--story-ink`, `--story-edge`, `--story-shadow`. O dourado e a tipografia continuam ligados à landing. Sombras ficam fora do recorte da atmosfera. Não adicionar glow, papel de parede de ícones ou imagens decorativas.

- Desktop: texto à esquerda, eixo central, produto à direita; o post ocupa o centro durante os handoffs.
- Até 860px: texto acima, eixo à esquerda, cenário abaixo; nós sociais mais separados, profundidade reduzida e sem planos decorativos próximos.
- Viewports baixas: composição horizontal compacta, dimensões reduzidas sem `zoom` no objeto (zoom altera suas coordenadas).
- Tamanho e posição são limitados pela área disponível. Não colocar `overflow:hidden` em ancestrais dos cenários para esconder problemas.
- O shell usa `overflow-x:clip` somente quando a narrativa existe, preservando sticky nativo.

Os metadados pequenos pertencem ao mockup decorativo. A copy funcional permanece fora da cena 3D, com leitura normal.

## Acessibilidade

Seis botões com hit area de 44px, `aria-current`, foco visível e ativação por Enter/Space. O link “Pular etapas” permanece disponível. Cópia inativa usa `aria-hidden` e `inert`; as representações decorativas ficam fora da árvore acessível. A camada de texto não pode capturar cliques sobre os marcadores.

`prefers-reduced-motion` remove profundidade, rotação, zoom, desfoque e deslocamento de câmera. O post mantém posição estável; recursos e progresso continuam disponíveis. A preferência é observada ao vivo.

## Validação desta passagem — 11/09/2026

Segunda rodada visual corrigiu interpenetração dos painéis, distância dos ícones mobile, oclusão da linha na aproximação central, foco dos marcadores e enquadramento em telas baixas.

143 combinações de viewport/progresso verificadas sem overflow horizontal ou cortes dos objetos principais: 320×568, 375×667, 390×844, 430×932, 768×1024, 1024×768, 1280×720, 1366×768, 1440×900, 1536×864, 1920×1080, 2560×1080 e 768×400. Capturados os seis momentos de foco e o handoff central no Edge Chromium headless local.

Conferidos wheel por pixels, PageDown/PageUp, retorno ao mesmo quadro, clique/Enter nos marcadores, resize, movimento reduzido e liberação do sticky. Escalas de 90%/110% foram simuladas com CSS zoom: isso não equivale ao zoom nativo da barra do navegador. Trackpad físico, dispositivos reais e FPS sustentados não foram medidos.

Vitest: **28 arquivos, 151 testes aprovados**. Build Vite aprovado. Não há scripts de lint/typecheck definidos no projeto. Build de validação e screenshots ficaram na pasta temporária, sem alterar os bundles de outras sessões em `public/react`.
