# Arquitetura

O projeto é dividido em dois produtos independentes:

```text
frontend/                 React + Vite (interface)
  src/lib/api.js          cliente HTTP; usa VITE_API_URL

src/                      backend Node.js + Express (API)
  routes/                 rotas de auth, OAuth e recursos restantes
  http/                   controllers e rotas HTTP por domínio
  use-cases/              regras de aplicação
  domain/                 regras de domínio sem Express/SQL
  repositories/           persistência
  infra/                  integrações externas e storage
  middleware/             autenticação, autorização e observabilidade
  db/                     pool e migrations PostgreSQL
```

## Contrato entre front e back

- O front acessa o backend pela fronteira `frontend/src/lib/api.js` (`apiFetch`
  para rotas autenticadas e `publicApiFetch` para autenticação pública).
- Em produção, defina `VITE_API_URL` com a URL pública da API, por exemplo
  `https://api.exemplo.com`.
- Em desenvolvimento, o Vite faz proxy de `/api`, `/auth`, `/oauth` e
  `/media-proxy` para `http://localhost:3000`.
- O backend aceita origens listadas em `FRONTEND_ORIGIN` (separadas por
  vírgula) e expõe `GET /health` para monitoramento.

## Direção das dependências

`routes -> controllers -> use-cases/repositories -> infra`.

As interfaces públicas (`/`, `/app.html`, `/login.html`, `/reset-password.html`,
`/verify-2fa.html` e `/admin.html`) são entradas compatíveis para o shell React.
O bundle é gerado por `npm run frontend:build` em `public/react/`; os HTMLs
monolíticos anteriores não fazem parte do runtime.

Domínio não deve importar Express, PostgreSQL ou componentes React. O front
não deve importar módulos de `src/`; sua única fronteira é a API HTTP.

## Convenções atuais

- Configuração de ambiente passa por `src/config/env.js`; módulos não devem
  executar migrations ou abrir conexões no momento do `require`.
- Integrações HTTP usam `src/infra/http/requestJson.js`, que centraliza
  timeout, retry de 429/5xx e erros estruturados.
- Erros de domínio carregam status HTTP; o `errorHandler` global traduz erros
  sem expor stack trace ou credenciais.
- Schemas de banco ficam em `src/db/migrations/` e as compatibilizações
  idempotentes de deploy ficam em `runtimeMigrations.js`.
- Testes backend usam Jest (`test:unit`, `test:integration`, `test:coverage`) e
  testes de componentes usam Vitest (`test:components`). `test:all` executa
  ambos.
