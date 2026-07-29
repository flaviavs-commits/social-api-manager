# Avaliação da stack e plano de migração para o Felixo System Design

- **Projeto**: `social-api-manager` (MeuEcooMedia) — publicação multi-plataforma em redes sociais
- **Data**: 2026-07-29
- **Autor**: Claude opus yolo · social-api-manager
- **Tarefa de origem**: "Meu Ecoo Social Mídia — Verificar a stack do Breno e avaliar a migração para o Felixo System Design"
- **Padrão de referência**: [Felixo System Design](https://github.com/Felipe-Alcantara/Felixo-System-Design) — `GUIA_MINIMO_QUALIDADE.md`, `DESIGN_SYSTEM_BACKEND.md`, `DESIGN_SYSTEM_FRONTEND.md`, `TEMPLATE-CONTEXTO-IA.md`, `GIT-POLITICA-DE-VERSIONAMENTO.md`

---

## 1. Resumo executivo

**Recomendação: migrar o padrão de qualidade, não a stack.**

A stack atual (Node + Express + PostgreSQL) é uma escolha legítima dentro do próprio Felixo System Design, que lista TypeScript/JavaScript como prioridades 2 e 3 e admite PostgreSQL quando o cenário exige concorrência, workers e volume — exatamente o caso aqui (publicação paralela em várias redes, cron, métricas). Reescrever em Django seria uma migração de plataforma, não de qualidade: alto custo, alto risco e sem ganho proporcional.

O que de fato falta é **conformidade com o padrão**, e isso é alcançável de forma incremental sobre a stack existente. O backend já tem uma base melhor do que o típico: separação em `routes/services/repositories/middleware/utils`, criptografia AES-256-GCM dos tokens de rede social, error handler que não vaza stack trace, cabeçalhos de segurança, rate limiting e 265 testes automatizados.

Os desvios concentram-se em quatro frentes, em ordem de gravidade:

| # | Desvio | Gravidade |
|---|--------|-----------|
| 1 | Frontend monolítico: `public/index.html` com 8.508 linhas / 448 KB, ~254 funções e todo o CSS/JS inline | Alta |
| 2 | Camadas vazando: SQL cru em rotas e serviços; integrações externas sem camada própria | Alta |
| 3 | Dois sistemas de migração concorrentes (`src/db/migrations/*.sql` **e** `runMigrations()` dentro do `server.js`) | Alta |
| 4 | Artefatos obrigatórios ausentes: `IA.md`, `.env.example`, `start_app.py`, `AGENTS.md` | Média |
| 5 | Suíte vermelha no `main` desde o commit de rebrand e sem gate de CI; 38 vulnerabilidades no `npm audit`, 29 delas vindas do CLI `vercel` em `dependencies` (§6) | Alta |

**Custo estimado**: 5 fases, ~3 a 5 semanas de trabalho focado. As fases 0 a 2 entregam a maior parte da conformidade com o menor risco.

---

## 2. Stack levantada

### 2.1 Backend

| Item | Valor |
|------|-------|
| Runtime | Node.js `>=20.9.0`, CommonJS |
| Framework | Express 4.18 |
| Banco | PostgreSQL (driver `pg`, pool `max: 30`) |
| Sessão/Auth | Bearer token assinado próprio (`src/utils/authToken.js`) + cache de usuário em memória (TTL 60s); TOTP para 2FA; `bcrypt` para senha |
| Testes | Jest 30 + Supertest — 19 suítes, 265 testes (264 passando, 1 falhando; ver §6.1) |
| Agendamento | `node-cron` (`src/services/scheduler.js`) + cron HTTP da Vercel |
| Mídia | `sharp`, `fluent-ffmpeg`, `ffprobe-static`, `multer`, Vercel Blob |
| IA | SDKs Anthropic, OpenAI e Google Gemini chamados direto nas rotas |
| Notificação | `web-push`, `nodemailer` |

### 2.2 Frontend

Estático puro, sem build step e sem framework: `public/index.html` (448 KB), `login.html`, `admin.html`, `reset-password.html`, `verify-2fa.html` e páginas legais. Dependências externas por CDN: `chart.js`, `jspdf`, Google Identity Services e `gapi`.

### 2.3 Infraestrutura

Deploy dividido: **backend no Railway** (Dockerfile, healthcheck `/api/config`) e **frontend/rewrites na Vercel** (`vercel.json` reescreve rotas de OAuth e media-proxy para o domínio do Railway). A autenticação atravessa os dois domínios via Bearer token — decisão já documentada em comentário no `src/server.js`.

### 2.4 O que já está aderente ao padrão

Vale registrar para não ser desfeito na migração:

- Estrutura em camadas nomeadas (`routes`, `services`, `repositories`, `middleware`, `utils`, `db`)
- `tokenCrypto.js`: AES-256-GCM com IV por registro, authTag e prefixo versionado `enc:v1:` que permite migração gradual sem quebrar dados antigos — implementação correta
- Error handler global que nunca expõe stack trace e diferencia 4xx de 5xx
- Cabeçalhos de segurança (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS condicional)
- Defesa contra SSRF no `/media-proxy` (token HMAC **e** allowlist de host/protocolo) — defense-in-depth explícito
- Webhook do TikTok valida HMAC sobre o corpo bruto antes do parse
- Queries parametrizadas (`$1`, `$2`) em todo o código lido — sem concatenação de SQL
- Comentários que explicam **o porquê** das decisões não óbvias, não o óbvio
- `package-lock.json` commitado

---

## 3. Diagnóstico de desvios

### 3.1 Frontend monolítico — `public/index.html` (Alta)

Um arquivo de 8.508 linhas concentra markup, um bloco `<style>` único e ~254 funções JavaScript inline. É o exemplo canônico do módulo "faz-tudo" que o `DESIGN_SYSTEM_BACKEND.md` §2.2 e o `GUIA_MINIMO_QUALIDADE.md` item 2 mandam tratar como sinal de refatoração.

Consequências práticas: impossível revisar diff, alto risco de conflito entre agentes/pessoas editando em paralelo, nenhuma reutilização entre `index.html` e `admin.html`, e nenhum teste de unidade viável sobre a lógica de tela.

**Risco adicional de supply chain**: `chart.js` é carregado do CDN **sem versão fixada e sem SRI**. Qualquer alteração no pacote publicado entra direto em produção. Isso contraria o item 6 do guia mínimo (dependências pinadas e auditadas).

### 3.2 Camadas vazando (Alta)

A camada de repositórios existe mas é contornada. Contagem de `pool.query` fora de `repositories/`:

| Arquivo | Ocorrências |
|---------|-------------|
| `src/routes/ai.js` | 24 |
| `src/services/platformHealth.js` | 4 |
| `src/routes/drafts.js` | 3 |
| `src/routes/oauth.js`, `posts.js`, `services/publisher.js`, `services/scheduler.js` | 2 cada |
| `src/routes/push.js` | 1 |

Não existe camada `integrations/`. As chamadas HTTP a provedores externos estão espalhadas: `services/publisher.js` (18 `fetch`), `repositories/tokensRepository.js` (5 — um repositório fazendo refresh de token por HTTP é inversão de camada), além de rotas e outros serviços.

`src/routes/ai.js` (1.121 linhas) é o caso mais grave: acumula construção de prompt (domínio), instanciação de clientes Anthropic/OpenAI/Gemini (integração), SQL cru (persistência) e handlers HTTP (API) no mesmo arquivo. O handler `POST /generate` sozinho ocupa ~230 linhas.

Os IDs de modelo de IA estão hardcoded em mapas espalhados (`CLAUDE_MODEL_IDS`, `OPENAI_MODEL_IDS`, `GEMINI_MODEL_IDS`), contrariando §5.4 (configuração centralizada).

### 3.3 Migrações duplicadas (Alta)

Existem 26 arquivos em `src/db/migrations/*.sql` **e** uma função `runMigrations()` de ~110 linhas dentro do `src/server.js` que cria tabelas, adiciona colunas, faz backfill e troca constraints — muitas vezes com `.catch(() => {})` engolindo o erro silenciosamente.

Isso viola §7.2 (toda mudança estrutural versionada) e §2.2 (o `server.js` deixa de ser bootstrap e vira também migrador). Pior: o `.catch(() => {})` significa que uma migração pode falhar em produção sem qualquer sinal. Há ainda numeração duplicada entre arquivos (`015_post_publications.sql` e `015_instagram_followers_history.sql`; `016_tiktok_stats_history.sql` e `016_post_metrics_history_platform.sql`), o que torna a ordem de aplicação ambígua.

### 3.4 Artefatos obrigatórios ausentes (Média)

| Artefato | Estado | Exigido por |
|----------|--------|-------------|
| `IA.md` | Ausente | `TEMPLATE-CONTEXTO-IA.md`; guia mínimo item 8 |
| `.env.example` | Ausente **e listado no `.gitignore`** | `DESIGN_SYSTEM_BACKEND.md` §10 |
| `start_app.py` | Ausente | `GUIA-START-APP-SCRIPT.md`; guia mínimo item 11 |
| `AGENTS.md` | Ausente | Convenção dos demais projetos Vitis Souls |

O `.env.example` estar no `.gitignore` é o desvio mais fácil de corrigir e um dos mais custosos hoje: não há nenhuma fonte versionada que liste as variáveis de ambiente necessárias. Pelo código, são pelo menos 15 (`DATABASE_URL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `FRONTEND_ORIGIN`, `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`, `TIKTOK_REVIEW_MODE`, `TIKTOK_REVIEW_USER_ID`, `PORT`, `LAN_IP`, `BLOB_READ_WRITE_TOKEN`).

### 3.5 Achados pontuais de segurança e operação

1. **`ssl: { rejectUnauthorized: false }` em `src/db/pool.js`** — a verificação do certificado TLS do Postgres está desligada, o que abre espaço para man-in-the-middle na conexão com o banco. Deve usar o CA do provedor.
2. **`TIKTOK_REVIEW_MODE`** cria um caminho de auto-login sem senha (`/api/review-token` e redirect na raiz). O código documenta que deve ser desligado após a aprovação, mas nada no sistema força isso. Merece data de expiração ou remoção após o review.
3. **`process.on('uncaughtException')` que apenas loga e segue** — mantém vivo um processo em estado potencialmente inconsistente. Aceitável como paliativo, mas deve ser registrado como dívida com plano de saída.
4. **`vercel` (CLI) está em `dependencies`**, não em `devDependencies`. Além de inflar a imagem Docker do Railway sem necessidade em runtime, é a origem de **29 das 38 vulnerabilidades** apontadas pelo `npm audit` (ver §6.2). É a correção de melhor relação custo/benefício de todo este documento.
5. **Cache de usuário em `Map` de processo** (`requireAuth.js`) não é compartilhado entre instâncias. Com mais de uma réplica no Railway, uma mudança de role pode levar até 60s para propagar em réplicas que não receberam a invalidação. Documentar o limite ou mover para armazenamento compartilhado.
6. **Tokens de verificação de domínio do TikTok hardcoded** em rotas do `oauth.js`. São valores públicos por natureza (não é vazamento de segredo), mas pertencem a configuração, não a código.

---

## 4. Decisão sobre a stack

O `DESIGN_SYSTEM_BACKEND.md` §3.2 diz: *"Se a stack escolhida fugir disso, a decisão deve ser justificada no projeto."* A justificativa existe e é sólida:

- **Node/Express está na ordem de preferência** (prioridades 2 e 3). Não é stack fora do padrão.
- **PostgreSQL é a escolha correta** pelo critério de §3.3: múltiplos usuários concorrentes, workers de publicação em paralelo, cron e histórico de métricas. SQLite não caberia.
- **O ecossistema é JS-nativo**: SDKs oficiais de Anthropic/OpenAI/Gemini, Vercel Blob, `sharp`, `web-push`. Reescrever em Python significaria trocar todos por equivalentes ou wrappers.
- **Reescrita não é migração de qualidade.** Trocar de linguagem não corrige nenhum dos quatro desvios acima — eles seriam reproduzidos na stack nova se o padrão não for aplicado antes.

**Ponto de atenção honesto**: a única exigência do padrão que a stack atual não atende bem é o `start_app.py` (Python) em projeto Node. A solução proposta é um `start_app.py` fino que apenas orquestra os comandos npm/docker — atende a intenção do guia (porta de entrada única e amigável) sem introduzir Python no runtime.

**Melhoria opcional, não bloqueante**: adotar TypeScript incrementalmente (via `checkJs` + JSDoc, ou `.ts` em módulos novos) subiria o projeto da prioridade 3 para a 2 do padrão. Recomendado como fase 5, depois que as fronteiras de camada estiverem estáveis — não antes, para não misturar duas refatorações grandes.

---

## 5. Plano de migração

Regra geral: cada fase é um conjunto de commits pequenos (`tipo: descrição`) nesta branch, com testes rodados e `IA.md` atualizado no mesmo passo. Nenhuma fase depende de rewrite total; todas preservam os contratos de API existentes.

### Fase 0 — Fundação documental e destravamento (baixo risco, alto retorno)

Quase sem alterar lógica:

0. **Consertar a suíte vermelha** (`tests/unit/totp.test.js:92`, issuer obsoleto após o rebrand) e **mover `vercel` para `devDependencies`**. São duas mudanças pequenas que devolvem o sinal verde dos testes e eliminam 29 das 38 vulnerabilidades — pré-requisito para que qualquer fase seguinte possa ser validada de verdade.
0b. **Adicionar gate de CI** rodando `npm ci && npm test` em pull request. Sem isso, nada impede o `main` de ficar vermelho de novo — foi exatamente o que aconteceu no commit `f80e184`.
1. Remover `.env.example` do `.gitignore` e criar o arquivo com as ~15 variáveis, **sem valores**, com comentário do que cada uma faz.
2. Criar `IA.md` a partir do `TEMPLATE-CONTEXTO-IA.md`, tratado como linha do tempo (registros datados, nunca reescritos). Registrar as decisões já tomadas que hoje só vivem em comentários no código: split Railway/Vercel, Bearer em vez de cookie, `trust proxy = 1`, formato `enc:v1:` dos tokens.
3. Criar `AGENTS.md` com as convenções (português, Conventional Commits, fronteiras de camada) e o roteamento "o pedido mexe em X → arquivo Y".
4. Criar `start_app.py` com menu interativo: Iniciar, Instalar/Setup, Configurar (.env), Status, Sair — cross-platform (`pathlib`, `sys.executable`, `subprocess`), delegando aos comandos npm.
5. Alinhar o `README.md` ao `DESIGN_SYSTEM_README.md`.

**Critério de pronto**: `python start_app.py` abre o menu e cada opção executa de verdade em macOS, Linux e Windows (ou verificação manual registrada por SO não testado).

### Fase 1 — Consolidar migrações (alto risco se adiado)

1. Extrair `runMigrations()` do `server.js` para `src/db/migrate.js`, com **runner próprio** que registra em tabela `schema_migrations` o que já foi aplicado.
2. Converter cada bloco embutido em arquivo `.sql` numerado, renumerando os duplicados (015/016) para uma sequência única e inequívoca.
3. **Remover os `.catch(() => {})`**: falha de migração deve abortar o boot com erro claro, não seguir em silêncio.
4. Rodar como passo explícito de deploy, não como efeito colateral do `app.listen()`.

**Critério de pronto**: banco novo criado do zero só pelo runner, e banco existente convergindo sem alteração de dados. Testar contra uma cópia do schema de produção antes de aplicar.

### Fase 2 — Fronteiras de camada

1. Criar `src/integrations/` com um adaptador por provedor: `meta.js`, `instagram.js`, `youtube.js`, `tiktok.js`, e `src/integrations/ai/` para Anthropic/OpenAI/Gemini. Nenhuma regra de negócio dentro; só tradução de/para o formato cru do provedor.
2. Modelar as plataformas por **Strategy** (§2.7 e §5.6): hoje `publisher.js` cresce por `if/else` a cada rede nova. Uma interface `publicar(post, conta)` por adaptador transforma "adicionar rede" em "adicionar arquivo", sem tocar no núcleo.
3. Mover os `pool.query` de rotas e serviços para os repositórios correspondentes (criar `aiRepository.js`, `draftsRepository.js`, `pushRepository.js`).
4. Tirar o HTTP de `tokensRepository.js`: o refresh de token vira `services/tokenRefreshService.js` usando `integrations/`.
5. Quebrar `routes/ai.js` (1.121 linhas): prompts para `src/domain/prompts/`, orquestração para `services/aiService.js`, rota fica fina.
6. Centralizar os IDs de modelo e demais parâmetros em `src/config/`.

**Critério de pronto**: nenhum `pool.query` nem `fetch` de provedor externo fora de `repositories/` e `integrations/`. Contratos de API inalterados — os testes de integração existentes devem passar sem edição.

### Fase 3 — Frontend

1. Quebrar `public/index.html` por domínio de tela: `assets/css/` e `assets/js/` em módulos ES (`api.js`, `posts.js`, `analytics.js`, `contas.js`, `ia.js`), compartilhados com `admin.html`.
2. Fixar versão e adicionar SRI nos CDNs, ou vendorizar as bibliotecas.
3. Aplicar os baselines do `DESIGN_SYSTEM_FRONTEND.md`: navegação por teclado, foco visível, contraste AA.
4. Introduzir build step só se a modularização por si não bastar — §2.1 manda preferir a solução mais simples.

**Critério de pronto**: nenhum arquivo de tela acima de ~800 linhas; verificação manual de acessibilidade registrada (o padrão dispensa teste automatizado para UI puramente visual, mas exige o registro).

### Fase 4 — Segurança e testes

1. Corrigir `rejectUnauthorized: false` usando o CA do provedor de Postgres.
2. Tratar as vulnerabilidades que sobrarem depois de mover `vercel` para `devDependencies` (feito na Fase 0): avaliar uma a uma as diretas — `multer` (alta), `file-type` e `node-cron` (moderadas) — e a transitiva `tar` (crítica). **Não rodar `npm audit fix --force`**: ele propõe downgrades e mudanças quebradoras.
3. Definir plano de saída para `TIKTOK_REVIEW_MODE` (remoção ou expiração automática).
4. Cobrir com teste o que §8.3 exige e ainda está descoberto: fluxo de publicação (`publisher.js`), refresh de token, e autorização por objeto (IDOR) nas rotas que recebem `:id`.
5. Documentar/limitar o cache de usuário em memória.

### Fase 5 — Opcional: TypeScript incremental

Só depois da fase 2. Começar por `checkJs` + JSDoc nos módulos de fronteira (`integrations/`, `repositories/`), sem big bang.

---

## 6. Validação executada e limites desta avaliação

### 6.1 Suíte de testes — executada em 2026-07-29

`npm ci` (825 pacotes) seguido de `npm test` (Jest 30, `--runInBand`). Saída real:

```
Test Suites: 1 failed, 18 passed, 19 total
Tests:       1 failed, 264 passed, 265 total
Time:        2.685 s
```

**A suíte está vermelha no `main`.** A falha é real e regressiva:

- `tests/unit/totp.test.js:92` espera `issuer=Social+Api+Manager`
- `src/services/totp.js:94` produz `issuer=MeuEcooMedia`

O commit `f80e184` ("rebrand: renomeia Social Api Manager para MeuEcooMedia nas paginas publicas") alterou o valor padrão do issuer sem atualizar o teste correspondente. O código-fonte está correto; o teste é que ficou obsoleto. Isso significa que houve pelo menos um deploy com a suíte vermelha — sinal de que **não há gate de CI bloqueando merge com teste falhando**, o que deve entrar no plano como item próprio.

### 6.2 Auditoria de dependências — executada em 2026-07-29

`npm audit`: **38 vulnerabilidades — 1 crítica, 20 altas, 15 moderadas, 2 baixas.**

O dado mais relevante para priorização: **29 das 38 vêm do pacote `vercel` (CLI)**, que está em `dependencies` em vez de `devDependencies`. Movê-lo elimina ~76% da superfície de vulnerabilidade sem tocar em nenhuma linha de lógica — passa de item cosmético (§3.5) a **item de segurança de alta prioridade**.

As 9 restantes, com as diretas destacadas:

| Pacote | Severidade | Dependência direta |
|--------|-----------|--------------------|
| `tar` | **crítica** | não (transitiva) |
| `multer` | alta | **sim** |
| `brace-expansion` | alta | não |
| `minimatch` | alta | não |
| `file-type` | moderada | **sim** |
| `node-cron` | moderada | **sim** |
| `protobufjs`, `uuid` | moderada | não |
| `body-parser` | baixa | não |

`npm audit fix --force` propõe downgrades e mudanças quebradoras (`vercel@50.41.0`, `node-cron@4.6.0`) — **não deve ser rodado às cegas**. O caminho correto é remover `vercel` de `dependencies` e reavaliar o que sobra.

### 6.3 Limites que permanecem

- A análise de código é **estática**: leitura, contagem por `grep` e inspeção de configuração. Não houve execução do servidor nem acesso a banco de dados.
- Arquivos lidos integralmente: `server.js`, `db/pool.js`, `middleware/requireAuth.js`, `services/tokenCrypto.js`, `vercel.json`, `railway.toml`, `package.json`, `.gitignore` e o primeiro terço de `routes/ai.js`. Os demais foram avaliados por contagem e amostragem — uma revisão linha a linha de `publisher.js` e `oauth.js` pode revelar itens adicionais.
- Os testes existentes cobrem utilitários, repositórios e rotas, mas **não** cobrem `publisher.js`, refresh de token nem autorização por objeto (IDOR) — as três áreas que a §8.3 do padrão trata como obrigatórias.

---

## 7. Próximos passos sugeridos

1. Validar esta avaliação com o Breno — especialmente a decisão de **manter Node/Express** e a ordem das fases.
2. Aprovada a direção, executar a Fase 0 nesta mesma branch (é a de menor risco e destrava o trabalho das demais). Os itens 0 e 0b — teste do issuer, `vercel` para `devDependencies` e gate de CI — podem sair na frente mesmo que o resto do plano ainda esteja em discussão: são correções isoladas, sem impacto em contrato de API.

> Ideia para quem quiser contribuir: o runner de migrações da Fase 1 e o `start_app.py` da Fase 0 são genéricos o bastante para virarem ferramenta reutilizável nos outros projetos Node da Vitis Souls, em vez de solução pontual deste repositório.
