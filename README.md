# Social API Manager

Gerenciador de contas de redes sociais com back-end Node.js + PostgreSQL.
Suporta Facebook, Instagram, YouTube, TikTok e Kwai via OAuth 2.0.

Possui login próprio (e-mail/senha ou Google) com **multi-tenancy**: cada
usuário só vê e gerencia as contas de redes sociais que ele mesmo conectou.
Usuários com papel de **administrador** ou **administrador principal**
(`super_admin`) têm acesso a todos os dados do sistema e a um painel de
gestão de usuários.

## Estrutura do projeto

```
social-api-manager/
├── src/
│   ├── server.js                  # Servidor Express principal
│   ├── db/
│   │   ├── pool.js                # Pool de conexão PostgreSQL (pg)
│   │   └── migrations/            # Scripts SQL versionados (rodar manualmente)
│   ├── middleware/
│   │   ├── logger.js              # addLog/requestLogger (grava em logsRepository)
│   │   ├── requireAuth.js         # Exige sessão ativa; carrega req.user (id/email/role)
│   │   ├── requireAdmin.js        # Exige role 'admin' ou 'super_admin'
│   │   └── requireSuperAdmin.js   # Exige role 'super_admin' (única que altera papéis)
│   ├── repositories/
│   │   ├── usersRepository.js     # CRUD de usuários + listagem/promoção (admin)
│   │   ├── credentialsRepository.js # Senha (bcrypt) e token de redefinição, separado de users
│   │   ├── contasRepository.js    # CRUD de contas + stats do dashboard (filtrado por dono)
│   │   ├── tokensRepository.js    # CRUD e renovação de tokens OAuth (filtrado por dono)
│   │   ├── postsRepository.js     # CRUD de posts agendados (filtrado por dono)
│   │   └── logsRepository.js      # Histórico de logs + SSE (filtrado por dono)
│   ├── routes/
│   │   ├── auth.js                # Login/cadastro/logout, "esqueci minha senha", login Google
│   │   ├── admin.js                # Gestão de usuários e visão global de contas (admin)
│   │   ├── oauth.js               # Fluxo OAuth: Meta, Google, TikTok
│   │   ├── accounts.js            # Endpoints de contas
│   │   ├── tokens.js              # Endpoints de tokens
│   │   ├── posts.js               # Endpoints de posts agendados
│   │   └── logs.js                # Logs + SSE stream em tempo real
│   └── services/
│       ├── scheduler.js           # Cron jobs: publicação automática + renovação de tokens (ativo)
│       └── mailer.js              # Envio de e-mail de redefinição de senha (Gmail SMTP)
├── public/
│   ├── login.html                 # Tela de login / cadastro / "esqueci minha senha"
│   ├── reset-password.html        # Tela de redefinição de senha (via link por e-mail)
│   ├── admin.html                 # Painel de administração (somente para admins)
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

- `users` — perfil dos usuários do sistema (email, nome, `role`: `super_admin`/`admin`/`user`, `google_id`)
- `credentials` — senha (bcrypt) de cada usuário, separada de `users`; contas criadas via Google não têm linha aqui
- `session` — sessões de login (gerenciada pelo `connect-pg-simple`)
- `nichos` — categorias/grupos de contas
- `contas` — contas conectadas (uma linha por conta, com colunas por plataforma e `user_id` do dono)
- `tokens` — tokens OAuth de cada conta/plataforma (`access_token`, `refresh_token`, `expires_at`, `status`)
- `posts` — posts agendados (com `user_id` do dono)
- `logs` — histórico de eventos (também usado pelo SSE em `/api/logs/stream`)

As migrations ficam em `src/db/migrations/` e devem ser rodadas manualmente,
em ordem, contra o banco configurado em `DATABASE_URL`:

```bash
psql $DATABASE_URL -f src/db/migrations/001_users_and_sessions.sql
psql $DATABASE_URL -f src/db/migrations/002_credentials.sql
psql $DATABASE_URL -f src/db/migrations/003_multi_tenancy.sql
psql $DATABASE_URL -f src/db/migrations/004_super_admin.sql
```

> Importante: colunas `timestamp` são gravadas e lidas em **UTC**. O parser de
> tipos do `pg` é configurado em `src/db/pool.js` para tratar
> `timestamp without time zone` como UTC — não remova essa configuração.

```env
DATABASE_URL=postgresql://usuario:senha@host:porta/banco
```

## Login, usuários e administração

### Acesso ao sistema

Toda a aplicação (exceto `/login.html` e `/reset-password.html`) exige sessão
ativa — sem login, o usuário é redirecionado para `/login.html`
(`src/middleware/requireAuth.js`). Duas formas de entrar:

- **E-mail e senha**: cadastro e login em `/login.html`, senha com bcrypt
  guardada em `credentials` (nunca em `users`).
- **Login com Google**: botão "Continuar com o Google" — reaproveita o
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` já configurados para o YouTube,
  com uma Redirect URI própria (`GOOGLE_LOGIN_REDIRECT_URI`). Cria a conta
  automaticamente no primeiro acesso; não gera linha em `credentials`.

### Esqueci minha senha

Fluxo completo em `/login.html` → `/reset-password.html`: gera um token de
uso único (validade de 1 hora) e envia um link por e-mail via Gmail SMTP
(`src/services/mailer.js`). Requer configurar no `.env`:

```env
SESSION_SECRET=defina_um_valor_aleatorio_longo
GOOGLE_LOGIN_REDIRECT_URI=http://localhost:3000/auth/login/google/callback
GMAIL_USER=seu_email@gmail.com
GMAIL_APP_PASSWORD=senha_de_app_de_16_caracteres
```

> `GMAIL_APP_PASSWORD` é uma "senha de app" gerada em
> https://myaccount.google.com/apppasswords — não é a senha normal da conta
> Google. Sem essa configuração, o link de redefinição não é enviado (o
> restante do fluxo, incluindo a troca de senha em si, continua funcionando
> caso o token seja obtido por outro meio).

### Multi-tenancy (isolamento por usuário)

Cada conta de rede social conectada (`contas.user_id`) e cada post agendado
(`posts.user_id`) pertence a um usuário. Todas as rotas de dados
(`/api/accounts`, `/api/tokens`, `/api/posts`, `/api/logs`) filtram
automaticamente pelo usuário autenticado — um usuário comum nunca vê contas,
tokens, posts ou logs de outro usuário.

### Administradores

A coluna `role` em `users` aceita três valores:

| Papel | Vê dados de todos os usuários | Promove/despromove outros usuários |
|-------|:---:|:---:|
| `user` (padrão) | ❌ — só as próprias contas | ❌ |
| `admin` | ✅ | ❌ |
| `super_admin` (administrador principal) | ✅ | ✅ |

Tanto `admin` quanto `super_admin` têm acesso irrestrito aos dados: as
mesmas rotas que normalmente filtram por dono (`/api/accounts`,
`/api/tokens`, `/api/posts`, `/api/logs`) retornam os dados de **todos** os
usuários para esses dois papéis (`src/utils/http.js#isAdminRole`). A
diferença entre eles é só a gestão de usuários:

- Painel `/admin.html` (link "Administração" só aparece na sidebar para
  quem tem `admin` ou `super_admin`; `super_admin` ainda recebe um selo "★
  principal" ao lado do link): lista todos os usuários do sistema, com ações
  para promover/despromover papel e ativar/desativar contas, e uma tabela de
  auditoria com todas as contas de redes sociais conectadas, por dono.
- Rotas `GET/POST /api/admin/*` (em `src/routes/admin.js`) exigem
  `src/middleware/requireAdmin.js` (`admin` ou `super_admin`); usuários
  comuns recebem `403`.
- **Somente `super_admin`** pode chamar `POST /api/admin/users/:id/role`
  (protegida por `src/middleware/requireSuperAdmin.js`) — um `admin` comum
  recebe `403` ao tentar promover ou despromover qualquer usuário. Essa rota
  só aceita promover para `admin` ou `user`; não é possível conceder
  `super_admin` por ela (esse papel só é atribuído via migration ou acesso
  direto ao banco, para não vazar esse nível de privilégio por engano).
- Proteções: não é possível remover o papel do último `super_admin`
  restante, nem um admin/super_admin desativar a própria conta.

O primeiro administrador principal é criado via migration
(`003_multi_tenancy.sql` cria o primeiro `admin`; `004_super_admin.sql`
eleva e-mails específicos a `super_admin`), que também atribui a ele todas
as contas/posts que já existiam no banco antes da migration (para nenhum
dado pré-existente ficar "sem dono"). Para promover outro usuário a `admin`
depois disso, use o próprio painel `/admin.html` logado como `super_admin`;
para criar um novo `super_admin`, edite a coluna `role` diretamente no banco.

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
2. Crie um app e ative o produto **Login Kit**
3. Configure a Redirect URI: `http://localhost:3000/oauth/tiktok/callback`
4. Para testes, use o modo **Sandbox** e adicione usuários em "Sandbox Users"
5. O fluxo OAuth usa **PKCE (S256)** — obrigatório desde 2024
6. O dashboard oferece duas formas de conectar: OAuth padrão ou **"Continuar com Google"** (se o usuário tiver conta TikTok vinculada ao Google)
7. Importante: TikTok **não suporta agendamento nativo** via API — posts vão ao ar imediatamente

```env
TIKTOK_CLIENT_KEY=awxxxxxxxxxxxxxxxxxx
TIKTOK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
TIKTOK_REDIRECT_URI=http://localhost:3000/oauth/tiktok/callback
```

> As rotas de OAuth ficam disponíveis tanto em `/auth/...` (usado pelo
> front-end para iniciar o fluxo) quanto em `/oauth/...` (usado como
> Redirect URI pelos provedores, conforme `.env`).

## Geração manual de token de longa duração (Facebook/Instagram)

Caso o fluxo OAuth automático (`/auth/meta`, `/auth/instagram`) não esteja
disponível (ex: app em revisão, Login do Facebook indisponível), é possível
gerar manualmente um Page Access Token de longa duração que **não expira**
(enquanto o acesso não for revogado) e funciona tanto para Facebook quanto
para a conta Instagram Business vinculada à página:

1. Acesse https://developers.facebook.com/tools/explorer
2. Selecione o app correto, escolha o **usuário**, adicione as permissões
   necessárias (`pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `pages_manage_metadata`, `instagram_basic`,
   `instagram_content_publish`, `instagram_manage_messages`) e clique em
   **"Generate Access Token"**
3. Copie o **App Secret** real em **Configurações → Básico** do app (não
   confundir com um access token — o App Secret tem ~32 caracteres
   hexadecimais)
4. Troque o token gerado por um **token de usuário de longa duração** (60 dias):
   ```
   GET https://graph.facebook.com/v18.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id=SEU_META_APP_ID
     &client_secret=SEU_META_APP_SECRET
     &fb_exchange_token=TOKEN_CURTO
   ```
5. Use o token de longa duração para listar as páginas e os tokens de página
   (não expiram) e as contas Instagram Business vinculadas:
   ```
   GET https://graph.facebook.com/v18.0/me/accounts
     ?fields=id,name,access_token,instagram_business_account
     &access_token=TOKEN_LONGO_DE_USUARIO
   ```
6. Cadastre o `access_token` da página retornada via:
   ```
   POST /api/tokens
   { "accountId": <id>, "platform": "facebook", "accessToken": "...", "accountName": "Nome da Página" }
   ```
   e repita para `"platform": "instagram"` usando o mesmo token (ele também
   é válido para a conta Instagram Business vinculada à página).

> Esse Page Access Token herda a validade do token de usuário que o gerou.
> Se o token de usuário (60 dias) expirar e precisar ser renovado, repita o
> processo a partir do passo 4 para obter novos tokens de página.

## Endpoints da API

> Todas as rotas abaixo (exceto `/auth/login/*`) exigem sessão ativa. As de
> `/api/accounts`, `/api/tokens`, `/api/posts` e `/api/logs` retornam apenas
> os dados do usuário autenticado, a menos que ele seja administrador.

### Login e conta

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/login/login` | Login com e-mail e senha |
| POST | `/auth/login/register` | Cadastro de novo usuário |
| POST | `/auth/login/logout` | Encerrar sessão |
| GET | `/auth/login/google` | Iniciar login com Google |
| GET | `/auth/login/google/callback` | Callback do login com Google |
| POST | `/auth/login/forgot-password` | Solicitar redefinição de senha (envia e-mail) |
| GET | `/auth/login/reset-password/validar` | Validar token de redefinição (`?token=`) |
| POST | `/auth/login/reset-password` | Definir nova senha a partir do token |
| GET | `/api/me` | Dados do usuário logado (`id`, `email`, `role`) |

### Administração (`role = 'admin'` ou `'super_admin'`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/users` | Lista todos os usuários do sistema |
| POST | `/api/admin/users/:id/role` | **Somente `super_admin`** — promove/despromove (`{ "role": "admin" \| "user" }`) |
| POST | `/api/admin/users/:id/ativo` | Ativa/desativa um usuário (`{ "ativo": true \| false }`) |
| GET | `/api/admin/accounts` | Lista todas as contas de redes sociais, de todos os usuários |

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
| GET | `/auth/tiktok` ou `/oauth/tiktok` | Iniciar OAuth TikTok |
| GET | `/auth/tiktok/google` | Iniciar OAuth TikTok via Google |
| GET | `/oauth/tiktok/callback` | Callback TikTok |
| GET | `/auth/kwai` ou `/oauth/kwai` | Conectar conta Kwai (simulado) |

### Logs
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/logs` | Lista logs recentes (`?limit=`) |
| GET | `/api/logs/stream` | SSE stream em tempo real |
| DELETE | `/api/logs` | Limpar logs |

## Scheduler (cron jobs)

`src/services/scheduler.js` é iniciado automaticamente com o servidor
(`scheduler.start()` em `src/server.js`) e roda dois jobs:

- A cada minuto: publica os posts cujo horário agendado já chegou
  (`postsRepository`/`publisher.js`) e notifica o front-end via SSE.
- A cada 6 horas (+ uma vez na inicialização): renova proativamente tokens
  expirados/expirando de todas as contas, de todos os usuários
  (`tokensRepository.renovarTodos`), para o usuário raramente precisar
  reconectar manualmente.

## Limites importantes das APIs

| Plataforma | Limite | Observação |
|------------|--------|------------|
| Facebook | 200 req/hora por token | Tokens duram 60 dias, extensíveis |
| Instagram | Igual ao Meta | Requer conta Business |
| YouTube | 10.000 unidades/dia | Upload = 1.600 unidades |
| TikTok | Sem agendamento nativo | PKCE obrigatório · Sandbox para testes |
| Kwai | Token dura 30 dias | Sem OAuth público — conexão simulada |

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
