# Social API Manager

Gerenciador de 100+ contas de redes sociais com back-end Node.js real.
Suporta Facebook, Instagram, YouTube e TikTok via OAuth 2.0 oficial.

## Estrutura do projeto

```
social-api-manager/
├── src/
│   ├── server.js                  # Servidor Express principal
│   ├── db/
│   │   └── database.js            # Banco de dados JSON (lowdb)
│   ├── middleware/
│   │   └── logger.js              # Logger de requisições
│   ├── routes/
│   │   ├── oauth.js               # Fluxo OAuth: Meta, Google, TikTok
│   │   ├── accounts.js            # CRUD de contas
│   │   ├── tokens.js              # Gestão e renovação de tokens
│   │   ├── posts.js               # Agendamento de posts
│   │   └── logs.js                # Logs + SSE stream em tempo real
│   └── services/
│       └── scheduler.js           # Cron jobs: publicação + renovação
├── public/
│   └── index.html                 # Front-end integrado com a API
├── data/
│   └── db.json                    # Banco de dados (criado automaticamente)
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

## Configuração das APIs

### Meta (Facebook + Instagram)

1. Acesse: https://developers.facebook.com
2. Crie um App → Business
3. Adicione os produtos: **Facebook Login** e **Instagram Graph API**
4. Em "Configurações do App", copie o App ID e App Secret
5. Configure a Redirect URI: `http://seudominio.com/oauth/meta/callback`
6. Solicite as permissões: `pages_manage_posts`, `instagram_content_publish`, `pages_read_engagement`

```env
META_APP_ID=1234567890
META_APP_SECRET=abcdef1234567890abcdef
META_REDIRECT_URI=http://localhost:3000/oauth/meta/callback
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

## Endpoints da API

### Contas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/accounts` | Lista todas as contas |
| GET | `/api/accounts/stats` | Estatísticas por plataforma |
| GET | `/api/accounts/groups` | Lista grupos |
| POST | `/api/accounts` | Criar conta manualmente |
| DELETE | `/api/accounts/:id` | Remover conta |

### Tokens OAuth
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/tokens` | Lista tokens com status |
| POST | `/api/tokens/renew/:id` | Renovar token específico |
| POST | `/api/tokens/renew-all` | Renovar todos expirados |

### Posts
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/posts` | Lista posts agendados |
| POST | `/api/posts` | Agendar novo post |
| DELETE | `/api/posts/:id` | Cancelar post |
| POST | `/api/posts/:id/publish-now` | Publicar imediatamente |

### OAuth
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/oauth/meta` | Iniciar OAuth Meta |
| GET | `/oauth/meta/callback` | Callback Meta |
| GET | `/oauth/google` | Iniciar OAuth Google |
| GET | `/oauth/google/callback` | Callback Google |
| GET | `/oauth/tiktok` | Iniciar OAuth TikTok |
| GET | `/oauth/tiktok/callback` | Callback TikTok |

### Logs
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/logs` | Lista logs recentes |
| GET | `/api/logs/stream` | SSE stream em tempo real |
| DELETE | `/api/logs` | Limpar logs |

## Scheduler (cron jobs)

O serviço `scheduler.js` executa automaticamente:

- **A cada minuto**: verifica posts na fila e publica os que estão no horário
- **A cada hora**: verifica tokens expirando e renova YouTube automaticamente
- **Todo dia à meia-noite**: log de status geral do sistema

## Banco de dados

O sistema usa `lowdb` — um banco de dados JSON simples, sem dependências nativas.
Os dados ficam em `data/db.json` e são criados automaticamente na primeira execução.

Para produção, substitua `lowdb` por **PostgreSQL** ou **MongoDB**:
- Troque `src/db/database.js` pela sua conexão de banco
- As queries são simples (filter, find, push) — fáceis de migrar

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
- **Banco de dados** real (PostgreSQL/MongoDB) em vez de `lowdb`
# social-api-manager
