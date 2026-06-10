# Social API Manager

Gerenciador de contas de redes sociais com back-end Node.js + PostgreSQL.
Suporta Facebook, Instagram, YouTube e TikTok via OAuth 2.0.

## Estrutura do projeto

```
social-api-manager/
├── src/
│   ├── server.js                  # Servidor Express principal
│   ├── db/
│   │   └── pool.js                # Pool de conexão PostgreSQL (pg)
│   ├── middleware/
│   │   └── logger.js              # addLog/requestLogger (grava em logsRepository)
│   ├── repositories/
│   │   ├── contasRepository.js    # CRUD de contas + stats do dashboard
│   │   ├── tokensRepository.js    # CRUD e renovação de tokens OAuth
│   │   ├── postsRepository.js     # CRUD de posts agendados
│   │   └── logsRepository.js      # Histórico de logs + SSE
│   ├── routes/
│   │   ├── oauth.js               # Fluxo OAuth: Meta, Google, TikTok
│   │   ├── accounts.js            # Endpoints de contas
│   │   ├── tokens.js              # Endpoints de tokens
│   │   ├── posts.js               # Endpoints de posts agendados
│   │   └── logs.js                # Logs + SSE stream em tempo real
│   └── services/
│       └── scheduler.js           # Cron jobs: publicação + renovação (não ativo)
├── public/
│   └── index.html                 # Front-end integrado com a API
├── docs/
│   └── app-info.json              # Metadados do app (submissão TikTok)
├── .env.example                   # Template de variáveis de ambiente
└── package.json
```

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Criar arquivo de configuração
cp .env.example .env

# 3. Preencher o .env com suas credenciais (ver abaixo)
nano .env

# 4. Iniciar o servidor
npm start
# Acesse: http://localhost:3000
```

## Banco de dados

O sistema usa **PostgreSQL** via `pg` (`src/db/pool.js`), conectado através da
variável `DATABASE_URL`. As tabelas principais são:

- `nichos` — categorias/grupos de contas
- `contas` — contas conectadas (uma linha por conta, com colunas por plataforma)
- `tokens` — tokens OAuth de cada conta/plataforma (`access_token`, `refresh_token`, `expires_at`, `status`)
- `posts` — posts agendados
- `logs` — histórico de eventos (também usado pelo SSE em `/api/logs/stream`)

> Importante: colunas `timestamp` são gravadas e lidas em **UTC**. O parser de
> tipos do `pg` é configurado em `src/db/pool.js` para tratar
> `timestamp without time zone` como UTC — não remova essa configuração.

```env
DATABASE_URL=postgresql://usuario:senha@host:porta/banco
```

## Configuração das APIs

### Facebook

1. Acesse: https://developers.facebook.com
2. Crie um App → Business
3. Adicione o produto: **Facebook Login**
4. Em "Configurações do App", copie o App ID e App Secret
5. Configure a Redirect URI: `http://seudominio.com/oauth/meta/callback`
6. Solicite as permissões: `pages_manage_posts`, `pages_read_engagement`, `public_profile`

```env
META_APP_ID=1234567890
META_APP_SECRET=abcdef1234567890abcdef
META_REDIRECT_URI=http://localhost:3000/oauth/meta/callback
```

### Instagram

Usa o fluxo **"Instagram API with Instagram Login"** (login feito direto em
`instagram.com`, separado do login do Facebook).

1. Acesse: https://developers.facebook.com → seu App → adicione o produto **Instagram**
2. Em "Configurações da API do Instagram", copie o **Instagram App ID** e **Instagram App Secret**
3. Configure a Redirect URI: `http://seudominio.com/oauth/instagram/callback`
4. Solicite as permissões: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`

```env
INSTAGRAM_APP_ID=1234567890
INSTAGRAM_APP_SECRET=abcdef1234567890abcdef
INSTAGRAM_REDIRECT_URI=http://localhost:3000/oauth/instagram/callback
```

### YouTube (Google)

1. Acesse: https://console.cloud.google.com
2. Crie um projeto → APIs e Serviços → Ativar **YouTube Data API v3**
3. Credenciais → Criar credenciais → ID do cliente OAuth 2.0 → Aplicativo da Web
4. Adicione a Redirect URI autorizada
5. Atenção: YouTube usa `refresh_token` — renovação automática sem interação do usuário

```env
GOOGLE_CLIENT_ID=123456.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdef123456
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/google/callback
```

### TikTok

1. Acesse: https://developers.tiktok.com
2. Crie uma conta TikTok for Business
3. Solicite acesso à **Content Posting API** (requer aprovação manual)
4. Importante: TikTok **não suporta agendamento nativo** via API — posts vão ao ar imediatamente
5. Para agendamento no TikTok, use ferramentas certificadas: Buffer, Metricool ou Publer

```env
TIKTOK_CLIENT_KEY=awxxxxxxxxxxxxxxxxxx
TIKTOK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
TIKTOK_REDIRECT_URI=http://localhost:3000/oauth/tiktok/callback
```

> As rotas de OAuth ficam disponíveis tanto em `/auth/...` (usado pelo
> front-end para iniciar o fluxo) quanto em `/oauth/...` (usado como
> Redirect URI pelos provedores, conforme `.env`).

## Endpoints da API

### Contas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/accounts` | Lista contas (filtros: `nicho`, `tipo`, `ativo`) |
| GET | `/api/accounts/stats` | Estatísticas para o dashboard |
| GET | `/api/accounts/:id` | Detalhe de uma conta |
| POST | `/api/accounts` | Criar conta (rápida ou completa) |

### Tokens OAuth
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/tokens` | Lista tokens com status (filtros: `status`, `platform`) |
| POST | `/api/tokens` | Adicionar token manualmente |
| POST | `/api/tokens/renew/:id` | Renovar token específico |
| POST | `/api/tokens/renew-all` | Renovar todos expirados/expirando |
| DELETE | `/api/tokens/:id` | Remover token |

### Posts
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/posts` | Lista posts (filtro: `status`) |
| POST | `/api/posts` | Agendar novo post |
| DELETE | `/api/posts/:id` | Cancelar post agendado |

### OAuth
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/auth/meta` ou `/oauth/meta` | Iniciar OAuth Facebook |
| GET | `/oauth/meta/callback` | Callback Facebook |
| GET | `/auth/instagram` ou `/oauth/instagram` | Iniciar OAuth Instagram (Instagram Login) |
| GET | `/oauth/instagram/callback` | Callback Instagram |
| GET | `/auth/google` ou `/oauth/google` | Iniciar OAuth Google |
| GET | `/oauth/google/callback` | Callback Google |
| GET | `/oauth/tiktok/callback` | Callback TikTok |

### Logs
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/logs` | Lista logs recentes (`?limit=`) |
| GET | `/api/logs/stream` | SSE stream em tempo real |
| DELETE | `/api/logs` | Limpar logs |

## Scheduler (cron jobs)

`src/services/scheduler.js` contém a lógica original de publicação automática
de posts e renovação automática de tokens, mas **não está ativo** no
`server.js` atual e ainda usa a API antiga (lowdb). Precisa ser migrado para
usar `postsRepository`/`tokensRepository` antes de ser religado.

## Limites importantes das APIs

| Plataforma | Limite | Observação |
|------------|--------|------------|
| Facebook | 200 req/hora por token | Tokens duram 60 dias, extensíveis |
| Instagram | Igual ao Meta | Requer conta Business |
| YouTube | 10.000 unidades/dia | Upload = 1.600 unidades |
| TikTok | Sem agendamento nativo | Aprovação prévia necessária |

## Deploy em produção

```bash
# Com PM2 (recomendado)
npm install -g pm2
pm2 start src/server.js --name social-manager
pm2 save

# Com Docker
docker build -t social-manager .
docker run -p 3000:3000 --env-file .env social-manager
```

Para produção, configure também:
- **HTTPS** obrigatório para as Redirect URIs das plataformas
- **Variáveis de ambiente** no servidor (não usar `.env` em produção)
- **`DATABASE_URL`** apontando para o PostgreSQL de produção
