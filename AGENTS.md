# AGENTS.md — como trabalhar neste repositório

Instruções para agentes de IA e para quem chega agora no projeto.

**Antes de mexer em qualquer coisa, leia o [`IA.md`](IA.md)** — é a linha do tempo técnica do projeto e explica decisões que o código sozinho não justifica.

---

## O que é este projeto

MeuEcooMedia: plataforma web que publica conteúdo em várias redes sociais (Instagram, Facebook, YouTube, TikTok) a partir de um lugar só, com agendamento, métricas e apoio de IA na composição dos posts.

Backend Node.js + Express + PostgreSQL. Frontend estático, sem framework e sem build step. Deploy dividido: backend no Railway, frontend na Vercel.

---

## Como rodar

```bash
python start_app.py
```

Abre o menu: **Instalar/Setup**, **Configurar**, **Iniciar**, **Testes**, **Status**.

Direto pelo npm, se preferir:

```bash
npm ci          # instala exatamente o que está no lockfile
npm run dev     # nodemon, reinicia ao salvar
npm test        # suíte completa
```

Antes da primeira execução: `cp .env.example .env` e preencha. O `.env.example` documenta as 36 variáveis, sem nenhum valor real.

---

## Convenções

- **Português** em código, comentários, commits e documentação.
- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Erros de API no formato `{ erro: "mensagem" }`, em linguagem para o usuário final — nunca jargão técnico nem stack trace.
- Comentários explicam **o porquê** de decisões não óbvias. Se o código já diz o quê, o comentário é ruído.
- Colunas do banco em português (`data_publicacao`, `ativo`).

---

## Onde mexer

| O pedido envolve | Vá para |
|---|---|
| Nova rota ou mudança de contrato da API | `src/routes/` |
| Regra de negócio, orquestração | `src/services/` |
| Query SQL, acesso a dados | `src/repositories/` |
| Autenticação, permissão, rate limit | `src/middleware/` |
| Mudança de estrutura do banco | `src/db/migrations/` (novo `.sql` numerado) |
| Publicação em rede social | `src/services/publisher.js` |
| Geração de conteúdo por IA | `src/routes/ai.js` |
| Fluxo OAuth de qualquer plataforma | `src/routes/oauth.js` |
| Tela, layout, comportamento de interface | `public/index.html`, `public/admin.html` |
| Bootstrap, middleware global, healthcheck | `src/server.js` |

---

## Regras que não devem ser quebradas

1. **SQL sempre parametrizado** (`$1`, `$2`). Nunca concatene valor em string de query.
2. **Nunca logue nem retorne** access token, refresh token, senha ou stack trace.
3. **Tokens de rede social são cifrados em repouso.** Passe por `src/services/tokenCrypto.js` — nunca grave em texto puro. O formato `enc:v1:` é versionado; se precisar mudar o esquema, crie `v2` e mantenha `v1` legível.
4. **Migração de banco é arquivo versionado**, nunca `ALTER TABLE` solto em código de aplicação.
5. **Segredo vem de variável de ambiente.** Se adicionar uma nova, documente em `.env.example` — sem valor.
6. **Não rode `npm audit fix --force`.** Ele propõe downgrades quebradores neste projeto. Trate as vulnerabilidades uma a uma.
7. **Rode `npm test` antes de commitar.** A suíte está verde (265/265) e o CI barra pull request que a quebre.

---

## Dívidas conhecidas

Estão mapeadas com plano de ação em [`docs/planejamento/AVALIACAO-STACK-E-PLANO-MIGRACAO-FELIXO-2026-07-29.md`](docs/planejamento/AVALIACAO-STACK-E-PLANO-MIGRACAO-FELIXO-2026-07-29.md). Resumo do que você vai encontrar e não deve piorar:

- `public/index.html` tem 8.508 linhas com todo o CSS e JS inline. **Não acrescente mais código inline nele** sem necessidade — a Fase 3 vai modularizar.
- Migrações duplicadas entre `src/db/migrations/*.sql` e `runMigrations()` dentro do `server.js`. **Use os arquivos `.sql`**, não a função.
- SQL cru vaza para rotas e serviços, e não existe camada `integrations/`. **Ao criar código novo, respeite as camadas** mesmo que o código ao redor não respeite.
- `src/db/pool.js` conecta com `rejectUnauthorized: false`.
- `TIKTOK_REVIEW_MODE` cria login sem senha; mantenha vazio fora do período de revisão.

---

## Ao terminar uma tarefa

1. `npm test` verde.
2. Registre no `IA.md` o que mudou — decisão de arquitetura, bug relevante, integração nova, convenção. Formato `[YYYY-MM-DD]`, append-only: **não reescreva registro antigo**; adicione um novo apontando a mudança.
3. Atualize a seção **Estado atual** do `IA.md` (essa sim é reescrevível).
4. Commit em Conventional Commits, explicando o **porquê** no corpo.
