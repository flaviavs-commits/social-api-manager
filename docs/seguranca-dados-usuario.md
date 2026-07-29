# Segurança dos dados de usuário — modelo atual

Auditoria de: quais dados são armazenados, como credenciais/tokens são
protegidos e como o isolamento entre contas é garantido. Referência: tarefa
"Verificar a segurança dos dados de usuário" (mesmo roteiro usado no
Planejador Financeiro).

## Dados armazenados

| Tabela | Conteúdo | Sensibilidade |
|---|---|---|
| `users` | email, nome, avatar, role, `totp_secret` | `totp_secret` é segredo — cifrado (ver abaixo) |
| `credentials` | `password_hash` (bcrypt), `reset_token`, `reset_token_expires` | `reset_token` armazenado como **hash SHA-256**, não em texto puro |
| `contas` | plataforma, handle, `user_id` dono | sem segredos — tokens ficam em `tokens` |
| `tokens` | `access_token`, `refresh_token` por conta | cifrados em repouso (AES-256-GCM) |
| `session` | dados de sessão (`connect-pg-simple`) | TTL curto |
| `oauth_pkce_state` | `code_verifier` do fluxo PKCE | de uso único, curto prazo |
| `app_events` / `logs` | eventos de auditoria/depuração | não deve conter tokens (ver política de log abaixo) |

## Credenciais e tokens: como são protegidos

- **Tokens de plataforma** (`access_token`/`refresh_token`): cifrados com
  AES-256-GCM em [`src/services/tokenCrypto.js`](../src/services/tokenCrypto.js),
  chave vinda de `TOKEN_ENCRYPTION_KEY` (sem fallback — falha se ausente).
  Todo caminho de escrita/leitura em
  [`src/repositories/tokensRepository.js`](../src/repositories/tokensRepository.js)
  passa por `encrypt`/`decrypt`.
- **Senha de login**: nunca armazenada em texto puro — só `password_hash`
  (bcrypt) em `credentials`.
- **Token de redefinição de senha** (`reset_token`): o valor enviado por
  e-mail/2FA é aleatório (32 bytes); o banco guarda apenas o **hash SHA-256**
  dele ([`src/repositories/credentialsRepository.js`](../src/repositories/credentialsRepository.js)).
  Um dump do banco não permite usar um link de redefinição diretamente.
- **TOTP secret**: cifrado do mesmo jeito que os tokens de plataforma antes
  de gravar em `users.totp_secret`.
- **Secrets de assinatura** (`AUTH_TOKEN_SECRET` para sessão de API,
  `SESSION_SECRET` para state de OAuth/mídia): o servidor agora falha ao
  subir se qualquer uma dessas env vars estiver ausente
  ([`src/utils/authToken.js`](../src/utils/authToken.js),
  [`src/routes/oauth.js`](../src/routes/oauth.js)) — evita assinar tokens
  com uma chave vazia por env var esquecida.
- **Logs**: não devem conter tokens em texto puro. Caso conhecido corrigido:
  o log de falha na troca do long-lived token do Instagram
  (`src/routes/oauth.js`) chegava a incluir o `access_token` de curta duração
  quando só a segunda etapa falhava — removido do log.

## Isolamento entre contas (multi-tenant)

- Toda tabela de dado de usuário carrega `user_id`, e os repositórios filtram
  por ele antes de expor ou modificar uma linha
  (`contasRepository.buscarContaPorId`, `tokensRepository.tokenPertenceAoUsuario`,
  rotas de `drafts.js`, `me.js`). Não foi encontrado IDOR (busca por id sem
  checar dono) nas rotas revisadas.
- **Bypass de revisão de app store**: `requireAuth.js` tem um modo que libera
  toda a API sem login, usado só para a revisão do Google Play. Antes só
  dependia de `REVIEW_MODE_NO_AUTH=true` ficar ligado — agora **também exige**
  `REVIEW_MODE_EXPIRES` (timestamp ISO no futuro); passado esse prazo, ou sem
  a variável, o bypass nunca ativa, mesmo que a flag fique esquecida em
  `true` num deploy futuro. Ver também
  [`docs/tiktok-review-mode.md`](tiktok-review-mode.md) para o bypass
  equivalente do TikTok (mais restrito: só afeta uma conta demo isolada, não
  a API inteira).

## O que foi corrigido nesta auditoria

1. `reset_token` deixou de ser gravado em texto puro — agora só o hash SHA-256.
2. Bypass de auth para revisão do Google (`REVIEW_MODE_NO_AUTH`) passou a
   exigir prazo de expiração explícito (`REVIEW_MODE_EXPIRES`).
3. `AUTH_TOKEN_SECRET`/`SESSION_SECRET` ausentes agora derrubam o servidor no
   boot, em vez de assinar tokens com chave vazia.
4. Log de erro no fluxo Instagram deixou de incluir o token de curta duração.

## Uso do `REVIEW_MODE_NO_AUTH`

Ao ativar para uma revisão, definir as duas variáveis juntas:

| Variável | Valor |
|---|---|
| `REVIEW_MODE_NO_AUTH` | `true` |
| `REVIEW_MODE_USER_ID` | id da conta demo/revisor |
| `REVIEW_MODE_EXPIRES` | data/hora ISO após a qual o bypass para de funcionar (ex.: `2026-08-15T00:00:00Z`) |

Passado o prazo, o bypass simplesmente para de funcionar — não é preciso
lembrar de desligar manualmente, mas o ideal continua sendo remover a env
var assim que a revisão terminar.
