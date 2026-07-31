# Contexto operacional — Social API Manager

## Estado atual (resumo vivo)

Última atualização: [2026-07-31]
- Fase: shell React autenticado e dashboard inicial conectados; módulos secundários já possuem rotas visuais e aguardam migração funcional.
- Estado: interrompido com motivo nesta etapa — dashboard, rascunhos, contas, calendário com ações, analytics, inbox, tokens, IA e agendador React com publicação imediata, mídia e opções principais foram migrados; validações avançadas de mídia e fluxos específicos por plataforma ainda exigem conversão funcional individual.
- Próximo passo: concluir validações específicas de cada plataforma e executar testes manuais autenticados.
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

## Decisões de design & convenções

- [2026-07-31] Aplicado o padrão Felixo de composição, mobile-first, foco visível, contraste, estados de interação e espaçamento consistente, adaptando a paleta dourada já usada pelo produto.
- [2026-07-31] Commits futuros seguem Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

## Testes importantes

- [2026-07-31] ✅ `npm run frontend:build` — bundle React produzido em `public/react/`.
- [2026-07-31] ✅ `npm test -- --runInBand` — 21 suítes e 305 testes passaram após impedir o bypass de revisão em `NODE_ENV=test`, desabilitar cache de usuário nos testes e alinhar o issuer TOTP padrão ao contrato existente.

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
