# Contexto operacional — Social API Manager

## Estado atual (resumo vivo)

Última atualização: [2026-08-03]
- Fase: shell React autenticado e dashboard inicial conectados; módulos secundários já possuem rotas visuais e aguardam migração funcional.
- Estado: interrompido com motivo nesta etapa — dashboard, rascunhos, contas, calendário com ações, analytics, inbox, tokens, IA e agendador React com publicação imediata, mídia e opções principais foram migrados; o agendador (`scheduler-page.jsx`) agora tem as validações client-side espelhando `validarCriacaoPost`/`videoRules.js` (ver decisão de 2026-08-03), mas os campos opcionais por rede que ainda não existem no formulário React (categoria/local do YouTube, local do Facebook/Instagram, reply control do Threads, visibilidade do LinkedIn, board do Pinterest, interações do TikTok) continuam pendentes de conversão.
- Próximo passo: expor no agendador React os campos opcionais por rede ainda ausentes (listados acima) e repetir o mesmo padrão de validação client-side para eles quando fizer sentido; depois disso, revisar `calendar-page.jsx`/`module-page.jsx` em busca de outros fluxos específicos por plataforma ainda não migrados. Testes manuais autenticados em navegador continuam pendentes — este ambiente não tem acesso a navegador/DB para login real (ver validação abaixo).
- Validação: `npm run frontend:build` concluído com sucesso após a fatia de publicação imediata.

## Objetivo do projeto

Gerenciar publicações e métricas de redes sociais em uma única interface, com autenticação e integrações oficiais de cada plataforma.

## Stack & dependências

- [2026-07-31] Backend: Node.js + Express.
- [2026-07-31] Frontend: React 19 + Vite, sem biblioteca adicional de UI.
- [2026-07-31] CSS: tokens e componentes próprios em `frontend/src/styles/tokens.css`.

## Decisões de arquitetura

- [2026-07-31] O novo frontend fica em `frontend/` e gera artefatos em `public/react/`, mantendo o backend Express e as rotas existentes.
- [2026-07-31] A primeira fatia migrada é a landing page pública; o dashboard legado permanece funcional para reduzir risco e permitir migração incremental.
- [2026-07-31] Componentes seguem a separação `components/ui`, `components/layout`, `sections` e `pages`, com arquivos `kebab-case.jsx`.
- [2026-08-03] Regras de validação client-side que espelham `src/domain/posts/*.js` ficam em `frontend/src/lib/*.js` (funções puras, sem React) — ex.: `postValidation.js`. O comentário de topo do arquivo aponta para o(s) arquivo(s) de domínio correspondente(s) no backend, que continuam sendo a fonte da verdade.

## Decisões de design & convenções

- [2026-07-31] Aplicado o padrão Felixo de composição, mobile-first, foco visível, contraste, estados de interação e espaçamento consistente, adaptando a paleta dourada já usada pelo produto.
- [2026-07-31] Commits futuros seguem Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

## Testes importantes

- [2026-07-31] ✅ `npm run frontend:build` — bundle React produzido em `public/react/`.
- [2026-07-31] ✅ `npm test -- --runInBand` — 21 suítes e 305 testes passaram após impedir o bypass de revisão em `NODE_ENV=test`, desabilitar cache de usuário nos testes e alinhar o issuer TOTP padrão ao contrato existente.
- [2026-08-03] ✅ `npm run frontend:build` e ✅ `npm test` (21 suítes / 305 testes) — passaram após adicionar `frontend/src/lib/postValidation.js` e as mudanças em `scheduler-page.jsx` (nenhum teste de backend foi afetado; não há suíte de frontend configurada no repositório — `jest.testMatch` só cobre `tests/**/*.test.js` no backend — então a lib nova ficou sem teste automatizado dedicado, coberta só pelo build/typecheck do Vite).
- [2026-08-03] ⚠️ Não executado: teste manual autenticado no navegador (login real + agendar um post por plataforma). Este ambiente de execução não tem navegador nem acesso ao Postgres configurado em `DATABASE_URL` — só shell. Fica como pendência explícita para quem tiver acesso a um ambiente com navegador e banco.

## Resumos de decisão

- [2026-07-31] CONTEXTO: introduzir React puro e modularização sem interromper o produto existente. ALTERNATIVAS: reescrever o dashboard inteiro ou migrar uma fatia vertical. DECISÃO: migrar a landing pública primeiro, isolando o build e conectando apenas `/` e `/sobre`. VALIDAÇÃO: build Vite e verificação das rotas Express.
- [2026-07-31] CONTEXTO: conectar o dashboard ao React sem descartar comportamentos legados. ALTERNATIVAS: apagar o `app.html` ou migrar por fatias. DECISÃO: conectar `/app.html` ao shell React, manter o legado no repositório e migrar cada módulo com seus contratos de API. VALIDAÇÃO: build Vite passou; a migração integral fica interrompida nesta etapa para evitar regressão silenciosa.
- [2026-07-31] CONTEXTO: avançar a migração funcional. DECISÃO: migrar rascunhos (listar, salvar e excluir) e contas conectadas (listar e desconectar) em componentes próprios, reutilizando `apiFetch`. VALIDAÇÃO: build Vite passou; os demais módulos permanecem preservados para a próxima fatia.
- [2026-07-31] CONTEXTO: substituir telas-base de calendário e analytics. DECISÃO: consumir `/api/posts/calendar` e `/api/posts/analytics` diretamente em componentes React, com navegação mensal e métricas numéricas sem nova dependência. VALIDAÇÃO: build Vite passou.
- [2026-07-31] CONTEXTO: substituir telas-base de inbox, tokens e IA. DECISÃO: consumir `/api/posts/inbox`, `/api/tokens` e `/api/ai/generate` com ações de renovação, remoção e geração de sugestões. VALIDAÇÃO: build Vite passou.
- [2026-07-31] CONTEXTO: migrar criação e agendamento. DECISÃO: iniciar com texto, data/hora e plataformas usando o contrato JSON de `/api/posts`; upload e configurações avançadas ficam isolados para a próxima fatia. VALIDAÇÃO: build Vite passou.
- [2026-07-31] CONTEXTO: adicionar mídia ao agendamento. DECISÃO: solicitar URL assinada em `/api/posts/upload-url`, enviar o arquivo diretamente por `PUT` e enviar metadados em `media` ao criar o post. VALIDAÇÃO: build Vite passou.
- [2026-07-31] CONTEXTO: completar as opções essenciais do agendador. DECISÃO: enviar `youtubeTitle`, `youtubeVisibility`, `igFormat`, `tiktokPrivacyLevel`, `firstComment` e `textByPlatform` pelos campos já suportados em `/api/posts`. VALIDAÇÃO: build Vite passou.
- [2026-07-31] CONTEXTO: concluir ações do calendário. DECISÃO: usar `PATCH /api/posts/:id` para reagendar e `DELETE /api/posts/:id` para excluir, com confirmação antes da exclusão. VALIDAÇÃO: build Vite passou.
- [2026-07-31] CONTEXTO: suportar publicação imediata no agendador. DECISÃO: alternar `publishNow` e usar o horário atual quando o modo imediato estiver ativo, mantendo data/hora obrigatória apenas para agendamento. VALIDAÇÃO: build Vite passou.
- [2026-08-03] CONTEXTO: fechar as validações específicas de cada plataforma no agendador React (próximo passo registrado em 2026-07-31), usando `src/domain/posts/post.js` (`validarCriacaoPost`) e `src/domain/posts/videoRules.js` (`isAspectRatioValidForTiktok`) como fonte da verdade — o app legado (`public/app.html`) foi auditado antes e tem duas lacunas reais que ele mesmo nunca cobriu no cliente: Instagram/TikTok exigem mídia mas isso nunca era checado antes do submit, e a proporção 9:16–16:9 do TikTok só era descoberta depois do upload, no erro 400 do backend. ALTERNATIVAS: (a) copiar 1:1 a lógica do `app.html` (`buildValidationIssues`/`schedulePost`) — descartada por herdar essas lacunas; (b) confiar só na mensagem de erro do backend após o submit — descartada por ser pior experiência e não seguir o padrão de qualidade (validar entrada antes de gastar upload). DECISÃO: criar `frontend/src/lib/postValidation.js` (funções puras, sem I/O exceto `readVideoMeta`, que lê metadados do vídeo no navegador via elemento `<video>` para checar a proporção do TikTok antes do upload) e usá-lo em `scheduler-page.jsx` para (1) um painel de pendências não-bloqueante (`.validation-panel`, estilo em `modules.css`) que atualiza a cada mudança do formulário, e (2) bloquear o submit (botão desabilitado + mensagem) enquanto houver pendência. Também corrigidos dois bugs pré-existentes descobertos durante a auditoria: `igFormat` tinha valor default/opção `"feed"`, mas o backend só aceita `post`/`reel`/`story` (todo post do Instagram com formato Feed falhava a validação); e o `<textarea>` do texto tinha `required`, impedindo posts só-com-mídia (o backend aceita texto OU mídia). Adicionado também o campo obrigatório `youtubeMadeForKids` (select Sim/Não), que nunca existia no formulário React — sem ele, todo post com YouTube selecionado era rejeitado pelo backend (COPPA/FTC, `post.js:139-143`). Campos opcionais por rede que o backend já suporta mas o formulário React ainda não expõe (categoria/formato do YouTube, local do Facebook/Instagram, `threadsReplyControl`, `linkedinVisibility`, board do Pinterest, `tiktokDisableComment/Duet/Stitch`) ficaram de fora desta fatia — não são "validação", são campos novos, registrados como próximo passo. VALIDAÇÃO: `npm run frontend:build` e `npm test` (21 suítes / 305 testes) passaram; teste manual autenticado em navegador não foi executado (sem navegador/DB neste ambiente — ver Testes importantes). RISCO: as regras client-side duplicam constantes do backend (ex.: `INSTAGRAM_MIN_ANTECEDENCIA_MIN = 20`, faixa de proporção do TikTok) — se alguém mudar `post.js`/`videoRules.js` sem atualizar `postValidation.js`, o aviso no React fica desatualizado (o backend continua sendo quem bloqueia de verdade, então não há risco de dado inválido entrar, só de o aviso ficar impreciso).
