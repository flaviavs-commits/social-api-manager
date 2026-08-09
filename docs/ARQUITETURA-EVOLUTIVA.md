# Diagnóstico e arquitetura evolutiva — Social API Manager

**Tipo:** revisão arquitetural baseada no código existente
**Data:** 2026-08-09
**Escopo:** backend, frontend, banco de dados, integrações externas, execução assíncrona, segurança, testes e deploy.

Este documento descreve o que existe hoje, quais são as responsabilidades de cada parte, onde estão os principais riscos e como evoluir o sistema com segurança. Ele é complementar ao [`ARCHITECTURE.md`](../ARCHITECTURE.md), que registra as decisões arquiteturais resumidas.

## 1. Conclusão executiva

O sistema é um **monólito modular** com frontend React e backend Express, persistência PostgreSQL e vários adaptadores para redes sociais, storage e provedores de IA. Essa é uma boa escolha para o estágio atual: o domínio ainda possui forte acoplamento entre publicação, tokens, contas, analytics e scheduler, e uma divisão imediata em microserviços aumentaria a complexidade operacional.

A arquitetura já possui bons elementos de uma arquitetura limpa:

- regras de posts isoladas em `src/domain/posts`;
- casos de uso para o módulo de posts;
- adaptadores de storage e provedores sociais em `src/infra`;
- criptografia de tokens e autenticação assinada;
- migrations versionadas;
- testes unitários, de integração e de componentes;
- frontend com cliente HTTP único e componentes reutilizáveis.

O principal problema não é falta de tecnologia. É **inconsistência de fronteiras**. Parte do sistema segue `rota → controller → caso de uso`, enquanto módulos centrais ainda misturam HTTP, SQL, regras de negócio, chamadas externas e tratamento de erro no mesmo arquivo. Os maiores pontos de atenção são:

1. `src/routes/ai.js` e `src/routes/oauth.js` são módulos muito grandes e concentram responsabilidades demais.
2. Há acesso direto ao `pool` em rotas, casos de uso e serviços, dificultando testes e evolução do modelo de dados.
3. O scheduler combina `node-cron`, endpoints de cron e processamento assíncrono dentro do processo web.
4. O contrato de autorização para administradores não está uniforme entre documentação, controllers, casos de uso e consultas.
5. O projeto possui dois modelos históricos de autenticação/documentação: tabela `session`/dependências de sessão e, no runtime atual, Bearer token assinado.
6. Migrations de deploy usam operações `best effort` que silenciam falhas, o que pode deixar ambientes parcialmente migrados.

### Direção recomendada

Manter o monólito, mas transformá-lo em um **monólito modular com portas e adaptadores**, separando o processo web do worker de publicação. A evolução deve ser incremental e vertical por módulo, começando por identidade/autorização e publicação.

```text
                    ┌─────────────────────────────┐
                    │ React/Vite                   │
                    │ páginas + componentes       │
                    └──────────────┬──────────────┘
                                   │ HTTP/JSON
                    ┌──────────────▼──────────────┐
                    │ API Express                  │
                    │ controllers + policies       │
                    └──────────────┬──────────────┘
                                   │ comandos/consultas
                    ┌──────────────▼──────────────┐
                    │ Aplicação modular            │
                    │ use cases + ports            │
                    └───────┬───────────┬──────────┘
                            │           │
              ┌─────────────▼───┐   ┌───▼────────────────┐
              │ PostgreSQL       │   │ Worker de jobs      │
              │ repositories     │   │ publicação/retry    │
              └──────────────────┘   └───┬────────────────┘
                                         │ adapters
                       ┌─────────────────┼─────────────────┐
                       │                 │                 │
                 Redes sociais       Storage             IA
```

## 2. Baseline verificado

| Área | Estado observado |
|---|---|
| Backend | Node.js `>=20.9`, Express 4, CommonJS |
| Frontend | React 19, Vite, JavaScript/JSX |
| Banco | PostgreSQL via `pg`, 43 migrations numeradas e compatibilizações de runtime |
| Storage | Vercel Blob e suporte legado a `public/uploads` |
| Redes | Facebook, Instagram, YouTube, TikTok e integração unificada Zernio |
| IA | OpenAI, Anthropic, Gemini, OpenRouter e catálogo de capacidades |
| Autenticação | Bearer token HMAC próprio, 2FA/TOTP, login local e Google |
| Execução assíncrona | Scheduler em processo, endpoints `/api/cron/*`, estados `processing`/`retry` |
| Deploy | Frontend/build em Vercel, API em Railway, Docker para o backend |
| Testes backend | 31 suítes, 353 testes aprovados na revisão |
| Testes frontend | 10 arquivos, 42 testes aprovados na revisão |
| Build | Vite aprovado; 91 módulos transformados |

O projeto foi analisado sem alterar o comportamento da aplicação. Os números acima são uma fotografia do estado validado em 2026-08-09.

## 3. Mapa da aplicação

### 3.1 Composição do backend

| Diretório | Responsabilidade atual | Avaliação |
|---|---|---|
| `src/server.js` | composição do Express, CORS, headers, arquivos estáticos, rotas públicas, auth global, healthcheck, migrations e start do scheduler | Correto como composition root, mas grande demais |
| `src/config` | leitura e validação parcial de ambiente | Deve virar configuração tipada/centralizada |
| `src/middleware` | autenticação, autorização, logging e cache de usuário | Boa separação inicial; precisa de policy única |
| `src/routes` | rotas legadas e módulos ainda não migrados | Mistura transporte com aplicação e persistência |
| `src/http/controllers` | tradução de `req/res` para casos de uso em parte da API | Padrão a ser aplicado ao restante |
| `src/http/asyncHandler.js` | tratamento de rejeições assíncronas | Deve ser padrão em todas as rotas |
| `src/http/errorHandler.js` | conversão central de erros para resposta | Evoluir para catálogo de erros e correlation id |
| `src/use-cases` | orquestração dos fluxos de posts | É a direção arquitetural correta |
| `src/domain` | regras puras de posts e analytics | Aumentar cobertura do domínio e remover dependências externas |
| `src/repositories` | acesso a usuários, contas, tokens e logs | Repositórios ainda recebem regras de autorização e integração |
| `src/infra/db` | repositório específico de posts | Deve seguir o mesmo contrato dos demais repositories |
| `src/infra/social` | clientes e publishers de APIs externas | Separar client HTTP, adapter de plataforma e orquestrador |
| `src/infra/storage` | Blob, mídia, conversão, probe e tokens de mídia | Bom isolamento; falta um contrato de mídia único |
| `src/services` | scheduler, métricas, comentários, saúde, push, mailer, Meu Ecoo e IA | Diretório amplo demais; precisa ser dividido por módulo |
| `src/db` | pool e migrations | Deve separar migration de inicialização da aplicação |

### 3.2 Frontend

O frontend é um shell React único em `frontend/src/main.jsx`. A navegação é feita por `history.pushState`, e as páginas são carregadas pelo `AppShell`/`ModulePage`.

| Área | Responsabilidade |
|---|---|
| `pages` | composição de telas: dashboard, agendador, calendário, analytics, inbox, contas, tokens, segurança, perfil, IA e administração |
| `components/ui` | componentes visuais compartilhados |
| `components/layout` | shell, cabeçalho e estrutura de navegação |
| `components/analytics` | visualizações e painéis de métricas |
| `components/ai` | widget e seleção de modelo |
| `hooks` | estados reutilizáveis de chamadas HTTP |
| `lib/api.js` | fronteira HTTP única, Bearer token, timeout e erro de API |
| `lib/postValidation.js` | validações client-side que espelham o domínio do backend |
| `workers` | validação de posts fora da thread principal |
| `styles` | tokens, módulos e estilos globais |

Ponto positivo: o frontend não importa módulos de `src/`; a integração ocorre pela API. Ponto de evolução: as páginas ainda concentram estado, transformação de resposta e regras de tela. O próximo passo é criar módulos de dados por domínio, sem introduzir uma biblioteca de estado global antes de haver necessidade real.

## 4. Módulos de negócio

### 4.1 Identidade e acesso

Responsável por registro, login local, login Google, logout, reset de senha, 2FA/TOTP, invalidação de tokens, perfil e papéis.

Arquivos principais:

- `src/routes/auth.js`;
- `src/routes/me.js`;
- `src/middleware/requireAuth.js`;
- `src/middleware/requireAdmin.js`;
- `src/middleware/requireSuperAdmin.js`;
- `src/repositories/usersRepository.js`;
- `src/repositories/credentialsRepository.js`;
- `src/utils/authToken.js`;
- `src/services/totp.js` e `src/services/mailer.js`.

Fluxo atual:

```text
login → bcrypt/Google → token HMAC → localStorage do frontend
                                      │
                                      ▼
                              Authorization: Bearer
                                      │
                                      ▼
                         requireAuth → req.user → policy
```

Recomendação: consolidar o módulo em `modules/identity`, mantendo o token atual inicialmente, mas abstraindo emissão/validação atrás de uma porta `SessionTokenService`. Isso permitirá rotação de segredo, revogação e futura migração sem alterar cada rota.

### 4.2 Contas conectadas e tokens

Modela a relação do usuário com contas externas e credenciais de redes sociais. Inclui conexão OAuth, token manual, renovação, status, avatar, healthcheck e integração Zernio.

Entidades centrais:

- `users`;
- `contas`;
- `tokens`;
- `oauth_pkce_state`;
- `platform_health`.

Risco importante: o token de acesso não tem significado único para todas as plataformas. Em alguns fluxos é o token OAuth real; na integração Zernio, o código documenta que ele representa o `accountId` do Zernio. Esse detalhe deve ser explicitado pelo modelo, por exemplo:

```text
ExternalAccountCredential
├── kind: oauth_token | provider_account_reference
├── platform
├── accessSecretEncrypted
├── refreshSecretEncrypted
└── expiresAt
```

Não é recomendável continuar usando um campo chamado `access_token` para dois conceitos distintos sem um discriminador.

### 4.3 Publicação e agendamento

É o núcleo operacional do produto. O fluxo cobre upload, validação, criação, agendamento, publicação por múltiplas contas, retry, publicação parcial, confirmação assíncrona, métricas e primeiro comentário.

Arquivos principais:

- `src/domain/posts/post.js`, `platformLimits.js`, `videoRules.js` e `errors.js`;
- `src/use-cases/posts/criarPost.js`, `listarPosts.js`, `reagendarPost.js`, `deletarPost.js`;
- `src/infra/db/postsRepository.js`;
- `src/infra/social/publisher.js`;
- publishers de Facebook, Instagram, TikTok, YouTube e Zernio;
- `src/services/scheduler.js`.

Estado recomendado para a publicação:

```text
draft → scheduled → processing →
                           ├── published
                           ├── partial
                           ├── retry_waiting → processing
                           └── failed
```

O estado atual já possui parte desse modelo, mas a informação está distribuída entre `posts`, `post_accounts`, `post_publications`, `instagram_pending`, `retry_count` e campos legados do post. A próxima evolução deve tratar cada tentativa por conta/plataforma como uma unidade de execução, evitando guardar estados concorrentes somente no registro agregado de `posts`.

### 4.4 Mídia

O navegador obtém URL pré-assinada em `blobStorage.js`, envia diretamente ao storage e o backend usa URLs permitidas para validação, conversão, probe e publicação.

Boas decisões existentes:

- limite de tamanho de 200 MB;
- allowlist de MIME types;
- proteção contra SSRF em `mediaFetch`/`media-proxy`;
- token HMAC de curta duração para APIs externas acessarem a mídia;
- `sharp` para normalização de imagens;
- `ffprobe` para metadados de vídeo.

Evolução recomendada: criar um `MediaAsset` persistido, em vez de transportar caminhos/URLs em muitos formatos (`mediaPath`, `mediaItems`, `media_by_platform`). O asset deve registrar proprietário, MIME, tamanho, checksum, storage key, estado de processamento e expiração.

### 4.5 Inbox e comentários

Consulta comentários por plataforma/provedor, marca como visto e responde. O caso de uso está em `src/use-cases/posts/inbox.js`, porém o acesso a `pool` e o comportamento dos provedores ainda atravessam limites de módulo.

Recomendação: criar a porta `CommentsProvider`:

```js
{
  listComments({ account, post, cursor }) {},
  reply({ account, post, commentId, text }) {}
}
```

O caso de uso deve decidir autorização e estado de leitura; o adapter deve conhecer apenas o contrato da plataforma.

### 4.6 Analytics

Combina histórico local, métricas externas, normalização de aliases, dados por conta, dados por publicação, demografia, crescimento e melhores horários.

Arquivos principais:

- `src/use-cases/posts/buscarAnalytics.js`;
- `src/services/metricsService.js`;
- `src/services/accountAnalyticsService.js`;
- `src/domain/analytics/normalizeAnalytics.js`;
- `src/domain/analytics/analyticsCatalog.js`;
- `src/services/instagramReconcileService.js`;
- componentes em `frontend/src/components/analytics`.

Ponto positivo: o catálogo e o normalizador reduzem a dependência de formatos diferentes. O risco é o serviço de métricas ter responsabilidade de cliente externo, normalização, persistência e agregação ao mesmo tempo. Dividir em:

1. `ProviderAnalyticsClient` por provedor;
2. `AnalyticsNormalizer` puro;
3. `AnalyticsSnapshotRepository`;
4. `BuildAnalyticsReport` como caso de uso;
5. DTOs de resposta para o frontend.

### 4.7 Agente de IA

O agente interpreta linguagem natural, lista capacidades, gera texto/imagem, consulta dados, navega no frontend e executa ações que exigem confirmação.

Arquivos principais:

- `src/routes/ai.js`;
- `src/services/ai/agentCatalog.js`;
- `src/services/ai/agentInterpreter.js`;
- `src/services/ai/agentExecutor.js`;
- `src/services/ai/analyticsInsights.js`.

O catálogo de capacidades e a separação entre interpretação e execução são boas decisões. O problema é que a rota ainda contém SDKs de vários provedores, persistência, prompts, limites, endpoints de imagem, chat, memória e execução operacional.

Arquitetura-alvo:

```text
AI HTTP Controller
        │
        ▼
Conversation Application Service
   ├── Intent Interpreter
   ├── Confirmation Policy
   ├── Capability Catalog
   ├── Action Dispatcher
   └── Conversation Repository
        │
        ├── Content Generation Port → AI provider adapters
        ├── Image Generation Port   → AI provider adapters
        └── Application use cases   → posts, analytics, drafts, inbox
```

O agente não deve acessar SQL diretamente nem possuir uma segunda implementação das regras de posts, drafts ou contas.

### 4.8 Auditoria, logs e notificações

`logsRepository`, `app_events`, polling de eventos e push notifications formam o mecanismo de feedback do sistema.

Diferenciar explicitamente:

- **log técnico:** diagnóstico para operação;
- **evento de domínio:** algo que ocorreu no negócio, como `PostPublished`;
- **notificação:** mensagem adaptada ao usuário, como push ou toast.

Hoje esses conceitos são parcialmente misturados. A separação permite trocar polling por SSE/WebSocket ou fila sem alterar o caso de uso de publicação.

## 5. Banco de dados e evolução do schema

O banco possui evolução incremental extensa, com tabelas de usuários/sessões, credenciais, contas, tokens, posts, publicações, métricas, logs, drafts, presets, textos salvos, push, inbox e IA.

### Problemas de schema a resolver

1. Existem campos legados no agregado `posts` ao lado de tabelas normalizadas (`post_accounts` e `post_publications`).
2. Opções por plataforma são armazenadas em várias colunas e JSONB, dificultando constraints e consultas consistentes.
3. A migration `runtimeMigrations.js` usa `bestEffort`, engole falhas e mistura compatibilidade com criação de schema.
4. O projeto documenta execução manual de migrations, mas o servidor também executa alterações no startup.
5. A migration inicial cria `session`, mas o runtime atual não usa `express-session`/`connect-pg-simple`.

### Política recomendada de migrations

- Um único mecanismo oficial de migration, executado antes do processo web ficar saudável.
- Tabela `schema_migrations` com versão, checksum, data e duração.
- Falha de migration deve impedir deploy, exceto em comandos explicitamente classificados como compatibilidade não crítica.
- `runtimeMigrations.js` deve ser esvaziado gradualmente e convertido em migrations numeradas.
- Operações de dados destrutivas devem possuir migration separada e plano de rollback lógico.
- Adicionar constraints e índices depois da migração de dados, com validação no CI.

### Modelo de publicação sugerido

Sem exigir uma reescrita imediata, o modelo futuro pode ser:

```text
posts
├── id, user_id, content, schedule, aggregate_status
└── post_targets
    ├── id, post_id, account_id, platform
    ├── content_snapshot, media_snapshot
    ├── status, retry_count, next_attempt_at
    ├── provider_reference, external_post_id
    └── last_error, published_at
```

Assim, um post para Instagram e YouTube terá dois alvos independentes, e `aggregate_status` será derivado de seus resultados.

## 6. Fluxos críticos

### 6.1 Autenticação

```text
Frontend login
  → POST /auth/login/login
  → validar credencial/2FA
  → gerarTokenSessao
  → localStorage.authToken
  → apiFetch adiciona Bearer
  → requireAuth consulta/cacheia usuário
  → política de acesso
```

Melhorias:

- retirar referências de sessão tradicional se o Bearer token for a decisão definitiva;
- adicionar `aud`, `issuer`, `jti` e versão ao token;
- criar estratégia de rotação de `AUTH_TOKEN_SECRET`;
- não usar `localStorage` para tokens de longa duração em uma futura revisão de segurança; preferir cookie HttpOnly com proteção CSRF se o frontend e API puderem compartilhar uma política de origem adequada;
- padronizar o tratamento de 401/403 e registrar auditoria de login, logout, reset e alteração de papel.

### 6.2 Conexão OAuth

```text
Usuário autenticado
  → inicia /auth/{platform}
  → state/PKCE
  → provedor externo
  → callback /oauth/{platform}/callback
  → troca code por token
  → sincroniza contas
  → cifra credencial
  → grava conta/token
  → redireciona para frontend
```

O callback não deve ficar responsável por toda a sincronização. Dividir em `OAuthStartUseCase`, `OAuthCallbackUseCase`, `ProviderOAuthClient` e `AccountConnectionService`.

### 6.3 Criação e publicação

```text
Frontend
  → URL pré-assinada
  → upload direto no Blob
  → POST /api/posts
  → validar domínio e mídia
  → criar post + targets em transação
  → responder 201/202
  → worker reserva target
  → adapter publica
  → persistir tentativa e referência externa
  → atualizar status agregado
  → evento + log + push
```

A resposta `202` precisa permanecer explicitamente assíncrona no contrato. O frontend não deve interpretar `202` como publicação concluída; deve acompanhar o evento/status da tentativa.

### 6.4 Analytics

```text
GET /api/posts/analytics
  → autorizar usuário/escopo
  → listar contas e credenciais válidas
  → consultar providers com timeout/retry
  → normalizar métricas
  → combinar histórico local
  → isolar falha por conta/relatório
  → responder DTO estável + capabilities/unavailable/errors
```

Essa estratégia de falha parcial é correta e deve ser preservada.

### 6.5 Agente IA

```text
mensagem
  → normalizar/intenção
  → plano com campos ausentes
  → política de confirmação
  → token de aprovação vinculado ao usuário/ação/args
  → dispatcher chama caso de uso existente
  → resposta estruturada + navegação
```

O token de aprovação deve incluir versão da ação e hash dos argumentos. Assim, uma confirmação para um payload não poderá ser reutilizada após os argumentos serem alterados.

## 7. Contrato de autorização e multi-tenancy

O isolamento por `user_id` está presente em várias consultas e é uma das propriedades mais importantes do sistema. Entretanto, o escopo administrativo precisa ser decidido e aplicado de forma única.

Foi observado o seguinte cenário:

- o README descreve que `admin`/`super_admin` veem dados de todos;
- comentários em `accounts.js` e `tokens.js` dizem que contas e tokens continuam restritos ao proprietário;
- `postsController` monta contexto com `isAdmin`;
- alguns controllers passam `false` explicitamente aos repositórios;
- o agente IA também possui consultas administrativas e consultas sempre restritas ao usuário.

Isso não deve ser resolvido por uma alteração isolada em SQL. Definir uma matriz de autorização:

| Recurso | `user` | `admin` | `super_admin` |
|---|---|---|---|
| Próprio perfil | ler/alterar | ler/alterar | ler/alterar |
| Próprias contas/tokens | ler/alterar | ler/alterar | ler/alterar |
| Contas/tokens de terceiros | negar | definir explicitamente | definir explicitamente |
| Posts próprios | ler/alterar conforme estado | definir explicitamente | definir explicitamente |
| Posts de terceiros | negar | definir explicitamente | definir explicitamente |
| Usuários | negar | listar/ativar conforme política | papel e operações críticas |
| Auditoria global | negar | conforme política | sim |

Depois, centralizar em uma policy:

```js
authorization.can(user, 'account:read', account)
authorization.scope(user, 'posts:read')
```

O repositório deve receber um `AccessScope` já resolvido, não uma combinação ambígua de `userId` e booleano `isAdmin` espalhada por toda a aplicação.

## 8. Dependências e fronteiras arquiteturais

### Direção desejada

```text
HTTP adapter
  → application use case
    → domain
    → ports
  → infrastructure adapters
    → database/external API/storage
```

### Violações observadas

| Evidência | Problema | Refatoração |
|---|---|---|
| `src/routes/ai.js` acessa `pool`, SDKs e casos de uso | rota é controller, serviço de IA, repositório e dispatcher ao mesmo tempo | dividir por controllers, application services, ports e adapters |
| `src/routes/oauth.js` acessa `pool`, Zernio, tokens e regras de callback | OAuth e conexão de contas estão acoplados ao Express | extrair casos de uso e clients de provedor |
| `src/routes/drafts.js`, `savedTexts.js`, `platformPresets.js` fazem SQL direto | transporte conhece schema | criar repositories/use cases |
| `src/use-cases/posts/inbox.js` usa `pool` diretamente | caso de uso conhece infraestrutura concreta | injetar `InboxRepository`/`CommentsProvider` |
| `src/use-cases/posts/criarPost.js` chama `processarPost` do scheduler | criação de post conhece execução assíncrona | publicar comando/evento em porta de jobs |
| `src/services/scheduler.js` acessa pool, push, logs, publishers e tokens | worker possui várias responsabilidades | separar jobs por comando e notificações por eventos |
| `src/infra/social/publisher.js` combina persistência e publicação | infraestrutura virou orquestrador de aplicação | mover orquestração para `PublishPostUseCase` |
| `server.js` inicia migrations e scheduler | composição e lifecycle não estão separados | criar `bootstrap`, `httpServer` e `worker` |

## 9. Riscos priorizados

| ID | Severidade | Risco | Impacto | Ação recomendada |
|---|---|---|---|---|
| A-01 | Crítica | scheduler em processo web e endpoints de cron coexistem | publicação duplicada, concorrência e comportamento diferente entre Railway/Vercel | worker dedicado, lock transacional e idempotency key |
| A-02 | Crítica | escopo administrativo inconsistente | exposição indevida ou bloqueio de operação legítima | matriz de autorização + testes por papel |
| A-03 | Alta | migrations `best effort` silenciam falhas | deploy saudável com schema incompleto | migration runner transacional e healthcheck de schema |
| A-04 | Alta | rotas monolíticas de IA/OAuth | mudança arriscada, testes lentos e alto acoplamento | decomposição por módulo e caso de uso |
| A-05 | Alta | tokens externos com semântica dupla | uso do segredo errado, falha de publicação ou vazamento | `credential_kind` e value objects |
| A-06 | Alta | callbacks e jobs sem idempotência uniforme | duplicação após retry/timeouts | chave por provider + account + target + operação |
| A-07 | Média | logs técnicos, eventos e notificações misturados | observabilidade inconsistente e dificuldade de replay | event bus interno/outbox |
| A-08 | Média | contrato HTTP sem schema formal | frontend e backend podem divergir silenciosamente | OpenAPI, validação de entrada e DTOs |
| A-09 | Média | dependências e documentação de sessão legadas | manutenção e auditoria de segurança confusas | remover ou documentar explicitamente a decisão |
| A-10 | Média | frontend concentra lógica nas páginas | regressões e baixa reutilização | hooks/services por domínio e testes de contrato |
| A-11 | Baixa | configuração não totalmente validada no startup | falha tardia durante uma ação | schema de ambiente com mensagens por variável |
| A-12 | Baixa | bundle de analytics e CSS global grandes | custo de carregamento e manutenção | code splitting adicional e CSS por feature |

## 10. Arquitetura-alvo de diretórios

A migração pode ocorrer sem mudar todo o projeto de uma vez. A estrutura abaixo é um destino, não uma exigência para um único commit:

```text
src/
├── app/
│   ├── bootstrap.js
│   ├── http-server.js
│   ├── worker.js
│   └── dependencies.js
├── config/
├── modules/
│   ├── identity/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── http/
│   ├── accounts/
│   ├── publishing/
│   ├── media/
│   ├── analytics/
│   ├── inbox/
│   ├── drafts/
│   ├── ai/
│   └── administration/
├── shared/
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   └── http/
└── db/
    └── migrations/
```

Cada módulo deve expor apenas sua API de aplicação, por exemplo:

```text
publishing/
├── application/
│   ├── create-post.js
│   ├── schedule-post.js
│   ├── publish-post-target.js
│   └── get-publication-status.js
├── domain/
│   ├── post.js
│   ├── publication-target.js
│   └── publication-status.js
├── ports/
│   ├── post-repository.js
│   ├── social-publisher.js
│   ├── media-storage.js
│   └── job-queue.js
├── infrastructure/
│   ├── postgres-post-repository.js
│   └── social-publisher-registry.js
└── http/
    ├── publishing-routes.js
    └── publishing-controller.js
```

## 11. Boas práticas obrigatórias para o próximo ciclo

### API e contratos

- Validar body, query e params por schema antes do caso de uso.
- Padronizar respostas de erro: `code`, `message`, `details`, `requestId`.
- Definir OpenAPI para os endpoints públicos.
- Manter `202` somente para operações realmente assíncronas.
- Usar paginação em posts, logs, comentários, usuários e analytics históricos.
- Definir limites por usuário para uploads, IA, endpoints de custo alto e cron.

### Banco e concorrência

- Usar transações para criar post, targets e mídia relacionada.
- Usar `SELECT ... FOR UPDATE SKIP LOCKED` ou advisory lock para reservar jobs.
- Adotar idempotência para callbacks OAuth, webhooks e publicação.
- Criar constraints para status e plataforma.
- Evitar `SELECT *` em repositórios que alimentam contratos externos.
- Não misturar migrations de schema com inicialização normal da API.

### Segurança

- Nunca registrar access token, refresh token, API key ou prompt sensível em logs.
- Rotacionar `AUTH_TOKEN_SECRET`, `SESSION_SECRET` e `TOKEN_ENCRYPTION_KEY` com procedimento documentado.
- Desligar e bloquear por ambiente qualquer modo `REVIEW_MODE_NO_AUTH` fora de um ambiente isolado.
- Validar origem, tamanho e tipo de mídia antes de qualquer processamento.
- Aplicar autorização no caso de uso, não somente na rota.
- Criar auditoria para alteração de papel, conexão/desconexão, publicação e resposta em comentários.

### Integrações externas

- Um adapter por provedor, implementando uma interface interna estável.
- Timeout, retry com backoff, `Retry-After`, circuit breaker e classificação de erro.
- Não enviar novamente uma publicação sem uma chave de idempotência.
- Preservar `providerRequestId` para suporte e troubleshooting.
- Separar limitação temporária, credencial inválida, conteúdo rejeitado e erro permanente.

### Observabilidade

- `requestId` em toda requisição e propagado para jobs/integrações.
- Logs estruturados em JSON no backend.
- Métricas: latência, taxa de erro, publicação por plataforma, retries, fila, tokens expirados e custo de IA.
- Healthcheck dividido em liveness e readiness.
- Alertas para falha de migration, backlog de publicação e aumento de erro por provedor.

## 12. Roadmap de implementação

### Fase 0 — contrato e segurança, baixo risco

1. Decidir e documentar a matriz de autorização.
2. Atualizar README para refletir Bearer token ou remover o legado de sessão.
3. Validar todas as variáveis de ambiente obrigatórias no startup.
4. Adicionar `requestId` e catálogo de erros.
5. Criar testes de isolamento para cada papel e recurso.

### Fase 1 — uniformizar a API

1. Aplicar `asyncHandler` a todas as rotas.
2. Migrar drafts, saved texts, presets, push e me para controllers/use cases/repositories.
3. Introduzir schemas de entrada e DTOs de saída.
4. Criar testes de contrato para frontend/backend.

### Fase 2 — publicação confiável

1. Separar `PublishPostTarget` de `PublishPost`.
2. Modelar `post_targets`/tentativas de publicação.
3. Criar worker separado do processo HTTP.
4. Adicionar lock, idempotência e dead-letter/status de falha permanente.
5. Manter o scheduler antigo apenas durante a migração, com uma única fonte de disparo por ambiente.

### Fase 3 — OAuth e contas

1. Extrair clients OAuth por plataforma.
2. Criar casos de uso de início/callback/sincronização.
3. Diferenciar token OAuth de referência Zernio no schema.
4. Migrar callbacks para testes de integração com fixtures redigidas.

### Fase 4 — analytics e IA

1. Separar clients de métricas, normalizadores e agregador.
2. Dividir `routes/ai.js` por feature: chat, generation, image, agent, memory, preferences.
3. Fazer o executor do agente chamar somente casos de uso públicos.
4. Versionar capacidades e tokens de aprovação.

### Fase 5 — frontend modular

1. Criar `frontend/src/modules/<feature>/api`, `hooks`, `schemas` e `components`.
2. Tirar transformações de dados das páginas.
3. Adicionar estados padronizados de loading, empty, error e retry.
4. Adicionar lazy loading para analytics e IA.

## 13. Critérios de aceite arquitetural

Uma mudança deve ser considerada pronta quando:

- a rota não contém regra de negócio nem SQL;
- o caso de uso pode ser testado sem Express e sem rede real;
- o adapter externo pode ser substituído por fake;
- a autorização é testada para usuário, admin e super admin;
- a operação assíncrona é idempotente;
- os erros retornam código estável e não expõem segredo;
- migrations foram aplicadas em ambiente limpo e em ambiente existente;
- o frontend consome um contrato documentado;
- logs e métricas permitem localizar usuário, post, target e provedor;
- `npm test`, `npm run test:components` e `npm run frontend:build` continuam aprovados.

## 14. Decisões arquiteturais registradas

### ADR-001 — Manter monólito modular

**Decisão:** não dividir o produto em microserviços agora.
**Motivo:** o domínio ainda evolui rapidamente e compartilha transações, autorização e modelo de publicação.
**Condição para rever:** volume de jobs, isolamento de escala ou ownership de equipe justificarem separação real.

### ADR-002 — Separar web e worker

**Decisão:** o processamento de publicação deve sair do lifecycle do processo HTTP.
**Motivo:** deploys, múltiplas instâncias e serverless tornam timers em processo pouco previsíveis.
**Implementação inicial:** worker Node separado com a mesma base de código e locking no PostgreSQL; fila externa pode ser adicionada depois.

### ADR-003 — Casos de uso como fronteira de negócio

**Decisão:** controllers e agentes chamam casos de uso; somente adapters conhecem SDKs, `fetch` externo e detalhes de banco.
**Motivo:** reduzir acoplamento e permitir testes rápidos.

### ADR-004 — Falha parcial em analytics

**Decisão:** uma falha de provedor não elimina dados válidos de outras contas/redes.
**Motivo:** as APIs externas possuem permissões, limites e capacidades diferentes.
**Contrato:** `capabilities`, `unavailable` e `errors` continuam explícitos.

## 15. Resultado esperado

Ao seguir esse plano, a aplicação continuará sendo um produto único para o usuário, mas internamente terá responsabilidades claras:

```text
HTTP traduz intenção
Aplicação coordena caso de uso
Domínio decide regras
Repositório persiste
Adapter conversa com terceiros
Worker executa trabalho assíncrono
Eventos notificam sem acoplar módulos
```

Essa evolução reduz risco de publicação duplicada, melhora a segurança multi-tenant, torna OAuth e IA testáveis, facilita a entrada de novas plataformas e permite escalar o processamento sem transformar o sistema prematuramente em uma coleção de serviços difíceis de operar.
