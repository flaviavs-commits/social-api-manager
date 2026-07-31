# Arquitetura

O projeto é dividido em dois produtos independentes:

```text
frontend/                 React + Vite (interface)
  src/lib/api.js          cliente HTTP; usa VITE_API_URL

src/                      backend Node.js + Express (API)
  routes/                 entrada HTTP por recurso
  http/                   controllers e rotas mais novas
  use-cases/              regras de aplicação
  domain/                 regras de domínio sem Express/SQL
  repositories/           persistência
  infra/                  integrações externas e storage
  middleware/             autenticação, autorização e observabilidade
  db/                     pool e migrations PostgreSQL
```

## Contrato entre front e back

- O front só acessa o backend via HTTP, pelo `apiFetch`.
- Em produção, defina `VITE_API_URL` com a URL pública da API, por exemplo
  `https://api.exemplo.com`.
- Em desenvolvimento, o Vite faz proxy de `/api`, `/auth`, `/oauth` e
  `/media-proxy` para `http://localhost:3000`.
- O backend aceita origens listadas em `FRONTEND_ORIGIN` (separadas por
  vírgula) e expõe `GET /health` para monitoramento.

## Direção das dependências

`routes/controllers -> use-cases -> repositories/infra`.

Domínio não deve importar Express, PostgreSQL ou componentes React. O front
não deve importar módulos de `src/`; sua única fronteira é a API HTTP.
