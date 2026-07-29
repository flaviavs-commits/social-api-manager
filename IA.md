# IA.md — contexto técnico do MeuEcooMedia

> Linha do tempo técnica do projeto, no formato do `TEMPLATE-CONTEXTO-IA.md` do Felixo System Design.
>
> **Regra de preservação**: registros datados são append-only. Quando uma decisão mudar, **não reescreva o registro antigo** — adicione um novo registro datado explicando o que mudou, por quê, e como foi validado. A única exceção é a seção **Estado atual**, que é um resumo reescrevível.
>
> Arquivo criado em 2026-07-29, durante a Fase 0 do plano de migração para o padrão Felixo. Os registros anteriores a essa data foram reconstruídos a partir do histórico do git e de comentários no código — estão marcados com `(retroativo)`.

---

## 📊 ESTADO ATUAL (RESUMO VIVO)

Última atualização: [2026-07-29]

- **Fase**: em produção. Publicação multi-plataforma funcionando (Instagram, Facebook, YouTube, TikTok), com agendamento, métricas e geração de conteúdo por IA.
- **Concluído**: Fase 0 do plano de migração para o padrão Felixo — suíte verde, gate de CI, `.env.example`, `start_app.py`, `IA.md`, `AGENTS.md`.
- **Em andamento**: nada. Fases 1 a 5 do plano aguardam validação do Breno.
- **Próximo passo**: Fase 1 — consolidar as migrações de banco, hoje duplicadas entre `src/db/migrations/*.sql` e `runMigrations()` dentro do `server.js`.
- **Riscos abertos**:
  - `src/db/pool.js` conecta ao Postgres com `rejectUnauthorized: false` (verificação de certificado TLS desligada).
  - `TIKTOK_REVIEW_MODE` cria caminho de login sem senha, sem prazo de expiração.
  - `public/index.html` com 8.508 linhas concentra todo o frontend.
  - 6 vulnerabilidades em produção, sendo `multer` de severidade alta.

---

## 🎯 OBJETIVO DO PROJETO

[2026-07-29] (retroativo) Plataforma web para gerenciar e publicar conteúdo em várias redes sociais a partir de um único lugar: conexão de contas por OAuth, composição de posts com apoio de IA, agendamento, publicação simultânea e acompanhamento de métricas. Público: criadores de conteúdo e pequenas empresas.

---

## 🏁 METAS & MILESTONES

- [2026-07-29] ✅ Avaliação da stack e plano de migração para o padrão Felixo — `docs/planejamento/AVALIACAO-STACK-E-PLANO-MIGRACAO-FELIXO-2026-07-29.md`
- [2026-07-29] ✅ Fase 0 — fundação documental e destravamento
- [2026-07-29] ⬜ Fase 1 — consolidar migrações de banco
- [2026-07-29] ⬜ Fase 2 — fronteiras de camada (`integrations/`, SQL fora das rotas)
- [2026-07-29] ⬜ Fase 3 — modularizar o frontend
- [2026-07-29] ⬜ Fase 4 — segurança e cobertura de testes
- [2026-07-29] ⬜ Fase 5 (opcional) — TypeScript incremental

---

## 🛠️ STACK & DEPENDÊNCIAS

- [2026-07-29] (retroativo) Backend: Node.js >=20.9.0 (CommonJS) + Express 4.18. Banco: PostgreSQL via driver `pg`, pool `max: 30`.
- [2026-07-29] (retroativo) Testes: Jest 30 + Supertest, rodando com `--runInBand`. 19 suítes, 265 testes.
- [2026-07-29] (retroativo) Agendamento: `node-cron` em `src/services/scheduler.js` + cron HTTP da Vercel.
- [2026-07-29] (retroativo) Mídia: `sharp`, `fluent-ffmpeg`, `ffprobe-static`, `multer`, Vercel Blob.
- [2026-07-29] (retroativo) IA: SDKs oficiais da Anthropic, OpenAI e Google Gemini.
- [2026-07-29] (retroativo) Notificação: `web-push` (VAPID) e `nodemailer` (Gmail).
- [2026-07-29] (retroativo) Frontend: HTML/CSS/JS estático, sem framework e sem build step. Chart.js, jsPDF, Google Identity Services e gapi via CDN.
- [2026-07-29] `vercel` (CLI) movido de `dependencies` para `devDependencies`. Não é usado em runtime; estava entrando na imagem Docker. Ver Resumos de Decisão.

---

## 📐 DECISÕES DE ARQUITETURA

- [2026-07-29] (retroativo) Deploy dividido: backend no **Railway** (Dockerfile, healthcheck em `/api/config`), frontend e rewrites na **Vercel**. O `vercel.json` reescreve rotas de OAuth e media-proxy para o domínio do Railway.
- [2026-07-29] (retroativo) Autenticação por **Bearer token** assinado próprio, não cookie de sessão. Motivo: o frontend e o backend estão em domínios diferentes por causa do split acima, e cookie cross-site traria atrito desnecessário. `trust proxy = 1` por estar atrás do proxy do Railway.
- [2026-07-29] (retroativo) Camadas nomeadas: `routes/`, `services/`, `repositories/`, `middleware/`, `utils/`, `db/`. **A separação não é respeitada de forma consistente** — há SQL cru em rotas e serviços, e chamadas HTTP a provedores externos espalhadas. Tratado na Fase 2 do plano.
- [2026-07-29] (retroativo) Tokens de rede social cifrados em repouso com **AES-256-GCM**, IV por registro e authTag (`src/services/tokenCrypto.js`). Formato `enc:v1:<iv>:<authTag>:<ciphertext>`. O prefixo versionado permite migração gradual: `decrypt` devolve como está o que não tiver o prefixo, então tokens antigos em texto puro continuam funcionando.
- [2026-07-29] (retroativo) Cache de usuário autenticado em `Map` de processo, TTL 60s (`src/middleware/requireAuth.js`), para evitar uma query por request. **Limite conhecido**: não é compartilhado entre réplicas — mudança de role pode levar até 60s para propagar em instâncias que não receberam a invalidação.
- [2026-07-29] (retroativo) Timestamps: `types.setTypeParser(TIMESTAMP)` força leitura como UTC. Sem isso o driver interpretava `timestamp without time zone` como horário local do processo, adiantando as datas em 3h.
- [2026-07-29] (retroativo) Defesa contra SSRF no `/media-proxy` em duas camadas: token HMAC **e** allowlist de host/protocolo.
- [2026-07-29] (retroativo) Webhook do TikTok valida assinatura HMAC sobre o **corpo bruto**, antes do parse do JSON.

---

## 🎨 DECISÕES DE DESIGN & CONVENÇÕES

- [2026-07-29] (retroativo) Código, comentários, commits e documentação em **português**. Nomes de colunas do banco em português (`data_publicacao`, `ativo`).
- [2026-07-29] (retroativo) Commits seguem **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- [2026-07-29] (retroativo) Respostas de erro da API no formato `{ erro: "mensagem" }`, em linguagem para o usuário final — não jargão técnico, nunca stack trace.
- [2026-07-29] (retroativo) Comentários explicam **o porquê** de decisões não óbvias, não o que o código já diz.
- [2026-07-29] Gate de CI em `.github/workflows/ci.yml`: `npm ci`, `npm test` e `npm audit --omit=dev` em todo pull request para o `main`.

---

## 🧪 TESTES IMPORTANTES

- [2026-07-29] ✅ Suíte completa: 19 suítes, 265 testes, todos passando. Cobrem utilitários, repositórios, rotas e componentes.
- [2026-07-29] ❌→✅ `tests/unit/totp.test.js` — "contém o issuer padrão" falhava. Ver Bugs & Fixes.
- [2026-07-29] **Lacuna conhecida**: não há teste cobrindo `services/publisher.js` (fluxo de publicação), refresh de token, nem autorização por objeto (IDOR) nas rotas com `:id`. São as três áreas que a §8.3 do padrão trata como obrigatórias. Previsto para a Fase 4.

---

## 🐛 BUGS & FIXES RELEVANTES

[2026-07-29] BUG: suíte vermelha no `main` — `tests/unit/totp.test.js:92` esperava `issuer=Social+Api+Manager`.
CAUSA: o commit `f80e184` ("rebrand: renomeia Social Api Manager para MeuEcooMedia") alterou o issuer padrão em `src/services/totp.js:94` sem atualizar o teste. O código estava correto; o teste ficou obsoleto.
FIX: teste atualizado para `issuer=MeuEcooMedia` (commit `271b1cd`).
LIÇÃO: o `main` seguiu vermelho por vários commits sem que nada barrasse o merge — não havia gate de CI. Gate adicionado em `.github/workflows/ci.yml`, para que a próxima regressão desse tipo pare no pull request.

---

## 🔗 INTEGRAÇÕES & SERVIÇOS EXTERNOS

> Nenhum segredo aqui — apenas o serviço e como está configurado. Os nomes das variáveis estão em `.env.example`.

- [2026-07-29] (retroativo) **Meta (Facebook/Instagram)** — OAuth + publicação. Vars `META_*` e `INSTAGRAM_*`.
- [2026-07-29] (retroativo) **YouTube (Google)** — OAuth + upload de vídeo. Vars `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. O "entrar com Google" usa redirect separado (`GOOGLE_LOGIN_REDIRECT_URI`).
- [2026-07-29] (retroativo) **TikTok** — OAuth, publicação e webhook. Vars `TIKTOK_*`. Verificação de domínio por arquivos `.txt` servidos em rotas de `src/routes/oauth.js`; são valores públicos por natureza, mas pertencem a configuração, não a código.
- [2026-07-29] (retroativo) **Anthropic / OpenAI / Google Gemini** — geração de conteúdo. A chave pode vir do ambiente ou da chave própria do usuário, cifrada na tabela `user_ai_keys`. Sem chave, a rota responde 503 com mensagem orientando o usuário.
- [2026-07-29] (retroativo) **Vercel Blob** — armazenamento de mídia. O SDK lê `BLOB_READ_WRITE_TOKEN` do ambiente automaticamente.
- [2026-07-29] (retroativo) **Web Push (VAPID)** e **Gmail** (`nodemailer`, senha de app) para notificação e e-mail transacional.

---

## 📝 NOTAS GERAIS

- [2026-07-29] O `TIKTOK_REVIEW_MODE` existe para o revisor da plataforma avaliar o app sem credenciais, e cria um caminho de login sem senha. Deve ficar **vazio** fora do período de revisão. Nada no sistema força isso hoje — a Fase 4 do plano prevê prazo de expiração ou remoção.
- [2026-07-29] `process.on('uncaughtException')` no `server.js` apenas registra e segue, mantendo vivo um processo possivelmente inconsistente. É paliativo consciente; a saída ainda não foi planejada.
- [2026-07-29] Trocar `TOKEN_ENCRYPTION_KEY` invalida todos os tokens já cifrados com a chave anterior. Os usuários precisariam reconectar as contas.

---

## 🧠 RESUMOS DE DECISÃO

[2026-07-29] CONTEXTO: avaliar se o projeto deveria migrar para o Felixo System Design e, se sim, se a stack (Node/Express/PostgreSQL) deveria ser trocada por Django, a prioridade 1 do padrão.
ALTERNATIVAS: (a) reescrever em Django; (b) manter a stack e aplicar o padrão de qualidade sobre ela; (c) não migrar nada.
DECISÃO: (b). O próprio `DESIGN_SYSTEM_BACKEND.md` lista JavaScript/TypeScript como prioridades 2 e 3, e o critério da §3.3 aponta PostgreSQL para cenários com concorrência, workers e volume — exatamente o caso. Além disso, o ecossistema é JS-nativo (SDKs de IA, Vercel Blob, `sharp`, `web-push`). O argumento decisivo: reescrever de linguagem não corrigiria nenhum dos quatro desvios encontrados; eles seriam reproduzidos na stack nova.
VALIDAÇÃO: plano completo em `docs/planejamento/AVALIACAO-STACK-E-PLANO-MIGRACAO-FELIXO-2026-07-29.md`, com os desvios mapeados por arquivo e contagem.

[2026-07-29] CONTEXTO: o `npm audit` apontou 38 vulnerabilidades (1 crítica, 20 altas), número alto o bastante para parecer intratável.
ALTERNATIVAS: rodar `npm audit fix --force`; atualizar dependência por dependência; investigar a origem antes de agir.
DECISÃO: investigar primeiro. 29 das 38 vinham de um único pacote — o CLI `vercel`, declarado em `dependencies` sem nunca ser exigido em runtime (não há `require('vercel')` no código). Movido para `devDependencies`. O `npm audit fix --force` foi descartado: propunha downgrade para `vercel@50.41.0` e `node-cron@4.6.0`, ambas mudanças quebradoras.
VALIDAÇÃO: `npm audit --omit=dev`, que mede o que de fato vai para a imagem do Railway, caiu de **38 para 6** vulnerabilidades. Saíram a crítica (`tar`) e 19 das 20 altas. Suíte segue 265/265. Restam `multer` (alta), `file-type` e `node-cron` (moderadas, diretas), mais `protobufjs`, `uuid` e `body-parser` transitivas — Fase 4.

[2026-07-29] CONTEXTO: definir em que severidade o gate de auditoria do CI deveria falhar.
ALTERNATIVAS: `--audit-level=high`, que é o alvo desejado; `--audit-level=critical`; ou auditoria não bloqueante.
DECISÃO: `critical` por enquanto, com comentário no workflow explicando o porquê e o gatilho para apertar. Em `high` o gate nasceria vermelho por causa do `multer`, e um gate que já nasce vermelho é um gate que o time aprende a ignorar.
VALIDAÇÃO: os dois níveis foram executados localmente — `critical` passa, `high` falha, confirmando o diagnóstico. Apertar para `high` ao fechar a Fase 4.
