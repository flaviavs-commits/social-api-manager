# Plano de segurança da aplicação

Data da análise: 2026-08-09  
Escopo: backend Node/Express, frontend React, PostgreSQL, autenticação, OAuth, tokens de redes sociais, uploads, IA, webhooks e implantação Vercel/Railway/Docker.

## Resumo executivo

A aplicação já possui bons controles: queries parametrizadas, separação de credenciais, bcrypt, TOTP, PKCE para TikTok, assinatura de webhooks, criptografia AES-256-GCM para tokens, filtros de multi-tenancy e cabeçalhos básicos.

Ainda assim, ela não deve ser considerada pronta para um nível máximo de segurança. Os maiores riscos são:

- possibilidade de tornar toda a API pública com `REVIEW_MODE_NO_AUTH=true`;
- token de sessão de 30 dias armazenado no `localStorage` e transportado pela URL após OAuth;
- segredos OAuth aparecendo em logs e um access token sendo persistido em JSON de publicação pendente;
- fluxo de mídia que ainda permite downloads externos sem uma política única de allowlist, limites e associação de objeto;
- CORS permissivo quando `FRONTEND_ORIGIN` não está configurado;
- ausência de rate limit abrangente para IA, uploads, OAuth, TOTP e operações de escrita;
- troca/reset de senha que não revoga imediatamente as sessões existentes;
- conexão PostgreSQL com `rejectUnauthorized: false`;
- migrações de runtime em modo `best effort`, permitindo que o servidor suba com schema incompleto.

O plano abaixo está ordenado por risco e dependência. Os itens P0 devem ser resolvidos antes de expor a aplicação a usuários reais; P1 deve ser concluído antes de declarar a plataforma endurecida; P2 e P3 formam a defesa em profundidade contínua.

## Evidências da revisão

- Testes backend: 31 suítes, 353 testes aprovados.
- Testes frontend: 10 suítes, 42 testes aprovados.
- `npm audit --omit=dev`: nenhuma vulnerabilidade conhecida nas dependências de produção no lockfile atual.
- A análise foi estática e baseada no código/configuração local. Não substitui pentest autenticado, DAST, revisão da infraestrutura hospedada ou análise de permissões reais do banco.

## Estado da implementação — 2026-08-10

Os controles de maior impacto já foram implementados no código:

- [x] bypasses de revisão removidos da autenticação; produção falha se flags de revisão estiverem ativas;
- [x] sessão migrada do `localStorage`/URL para cookie `HttpOnly`, com `Secure`/`SameSite`, expiração de 8 horas e rotação/revogação em login, logout, troca e reset de senha;
- [x] frontend deixou de enviar ou persistir token de sessão em JavaScript; Bearer permanece apenas como compatibilidade temporária para clientes antigos;
- [x] CORS passou a aceitar somente origens exatas, com credenciais; mutações com `Origin` não autorizado são rejeitadas;
- [x] logs possuem redator central e o estado pendente do Instagram não persiste access/refresh token;
- [x] mídia externa foi restringida ao Blob configurado, sem redirects, com allowlist de MIME e limite de 200 MB por stream;
- [x] upload exige MIME exato permitido, limite de 30 URLs por hora e agendamento por IA rejeita mídia fora do storage oficial;
- [x] cabeçalhos de segurança, HSTS em produção, limite global de API e limites específicos para IA/TOTP foram adicionados;
- [x] senhas novas exigem 12–72 caracteres, bcrypt custo 12, e tokens de reset são armazenados como hash SHA-256;
- [x] PostgreSQL não usa mais `rejectUnauthorized: false` e possui timeouts de conexão/consulta;
- [x] suíte validada: 31 suítes/353 testes backend, 10 suítes/42 testes frontend, sintaxe JavaScript validada e `npm audit --omit=dev` sem vulnerabilidades.

### Operação obrigatória antes de produção

1. Executar `src/db/migrations/044_security_reset_tokens.sql`; essa migration invalida links de reset antigos que poderiam estar armazenados em claro.
   Para evitar erro no ambiente remoto atual, use `npm run db:migrate:security:local`, que recusa automaticamente qualquer `DATABASE_URL` fora de um host local.
2. Configurar `BLOB_ALLOWED_HOSTS` com os hostnames exatos do storage e `TRUST_PROXY` conforme a topologia real (o deploy validado exige `1`).
3. Rotacionar credenciais OAuth/token que possam ter aparecido em logs ou no JSON antigo de publicação pendente.

Ainda dependem de trabalho de infraestrutura/revisão dedicada: RLS no PostgreSQL e papéis de banco, store distribuído de rate limit/quotas por tenant, state OAuth de uso único persistido no servidor, recovery codes/WebAuthn, validação por assinatura mágica no upload, storage privado, CSP/Helmet completa, replay/idempotência de webhooks e pentest/DAST. A aplicação não deve ser declarada “segurança máxima” antes desses itens.

### Deploy controlado realizado

- Railway produção: deployment `03fc0032-2092-4095-ad7b-e96644cda568`, concluído com sucesso;
- Vercel produção: deployment `dpl_DvHRreTnXDBefH3SL2NvXqwPRgss`, aliasado em `https://meuecoomidia.com.br`;
- PostgreSQL: migration 044 aplicada em transação, com `0` tokens de reset remanescentes;
- TLS PostgreSQL: CA Railway configurada por Base64 e certificado fixado por fingerprint, sem `rejectUnauthorized=false`;
- flags de revisão desativadas/removidas na produção.

## P0 — corrigir imediatamente

### P0.1 Remover o bypass global de autenticação

Evidência: `src/middleware/requireAuth.js:27-36` libera todas as rotas após o middleware quando `REVIEW_MODE_NO_AUTH=true`. `src/server.js:234-238` também emite token nesse modo.

Risco: uma variável de ambiente ativada por engano transforma dados de usuários, contas, tokens, posts e logs em dados públicos. O impacto inclui tomada de contas de redes sociais e exposição de dados de todos os tenants.

Ações:

- remover o bypass do código de produção;
- se o modo de revisão for indispensável, colocá-lo em uma build/ambiente separado, com tenant demo isolado e somente endpoints explicitamente allowlisted;
- fazer o processo falhar no startup se `NODE_ENV=production` e qualquer modo de revisão estiver ativo;
- remover `/api/review-token` da produção ou protegê-lo por allowlist de IP, expiração curta e ambiente exclusivo;
- adicionar teste de segurança garantindo que `REVIEW_MODE_NO_AUTH` nunca libera a API em produção.

Critério de aceite: com qualquer combinação de flags de revisão, uma requisição sem credencial recebe `401` em toda rota de dados de produção.

### P0.2 Substituir tokens no `localStorage` por sessão segura

Evidências: `frontend/src/lib/api.js:1` lê `authToken` do `localStorage`; `frontend/src/pages/auth-page.jsx:57-94` grava o token; `src/utils/authToken.js:27-36` emite credencial válida por 30 dias; `src/routes/auth.js:141-144` informa que logout não revoga o token.

O login OAuth ainda redireciona com o token na query string em `src/routes/auth.js:447-448` e no modo de revisão em `src/server.js:187-189`.

Risco: qualquer XSS, extensão maliciosa, script de terceiro, log de proxy, histórico, referer ou captura da URL pode roubar uma sessão longa. O logout atual só remove a cópia local.

Implementação recomendada:

- usar sessão opaca aleatória, armazenada no servidor ou em Redis/PostgreSQL, com hash do identificador no banco;
- enviar sessão em cookie `HttpOnly; Secure; SameSite=Lax/Strict`, com domínio e caminho restritos;
- implementar expiração absoluta e ociosa, rotação após login/elevação de privilégio, limite por dispositivo e revogação individual;
- proteger mutações com token CSRF ou mecanismo equivalente;
- substituir o token OAuth na URL por um código de uso único, curto, trocado pelo backend por cookie de sessão;
- enviar `Referrer-Policy: no-referrer` nas páginas de autenticação e limpar a URL imediatamente;
- manter `logout-all` e também revogar sessões no logout, troca/reset de senha, desativação de usuário e mudança de papel.

Critério de aceite: nenhum segredo de sessão aparece em URL, `localStorage`, `sessionStorage`, HTML ou logs; logout invalida o token no servidor; XSS não consegue ler a sessão.

### P0.3 Eliminar segredos de logs e dados de publicação pendente

Evidências:

- `src/routes/oauth.js:672-673` registra `JSON.stringify(token)`, que pode conter `access_token` e `refresh_token`;
- `src/routes/oauth.js:317`, `:413` e `:468` registram respostas completas de provedores;
- `src/infra/social/publisher.js:194-197` inclui o access token decifrado em `instagram_pending` antes de gravá-lo no PostgreSQL.

Risco: logs, backups, tabelas operacionais e ferramentas de observabilidade passam a ser fontes de credenciais reutilizáveis, anulando parte da proteção de `tokenCrypto.js`.

Ações:

- criar um redator central que remova campos `access_token`, `refresh_token`, `client_secret`, `api_key`, `authorization`, `code` e `token` antes de qualquer log;
- nunca persistir tokens em `instagram_pending`; guardar apenas `token_id`, estado do provedor e identificadores necessários, buscando o segredo decifrado no momento do uso;
- localizar e remover valores já gravados em logs/JSON e invalidar/rotacionar tokens potencialmente expostos;
- aplicar retenção curta, controle de acesso e criptografia nos logs;
- adicionar teste que falhe se qualquer log ou payload persistido contiver um token completo.

Critério de aceite: grep/scan automatizado dos logs e das tabelas não encontra tokens completos, e o fluxo pendente continua funcionando apenas com `token_id`.

### P0.4 Fechar o SSRF e o abuso de processamento de mídia

Evidências:

- `src/infra/social/mediaFetch.js:19-24` faz `fetch(mediaPath)` para qualquer URL HTTP(S);
- `src/routes/ai.js:1561-1630` aceita `p.mediaPath` no fluxo de agendamento e não reaplica a validação do fluxo manual;
- `src/use-cases/posts/criarPost.js:200-205` restringe o fluxo manual, mas `isBlobUrl()` aceita qualquer hostname terminado em `.public.blob.vercel-storage.com`;
- conversões e probes usam buffers/arquivos potencialmente grandes e podem ser executados em paralelo.

Risco: acesso a rede interna/metadata em fluxos legados ou de IA, consumo de CPU/memória/disco, criação de arquivos públicos e negação de serviço.

Ações:

- centralizar uma função de resolução de mídia usada por todos os fluxos, sem exceção;
- aceitar somente hosts exatos da conta de storage própria, HTTPS, path de objeto emitido pelo sistema e objeto previamente associado ao usuário/post;
- rejeitar redirects, URLs com credenciais, IPs literais e destinos que resolvam para loopback, link-local, RFC1918, IPv6 local ou metadata cloud;
- validar o upload no servidor/worker por assinatura mágica, não apenas pelo MIME enviado pelo navegador;
- impor limite de quantidade de arquivos, bytes totais por post/usuário/dia, tamanho de resposta, tempo, concorrência e espaço temporário;
- baixar por stream com abort e limite de bytes; não usar `arrayBuffer()` sem limite;
- executar `sharp`/`ffprobe` em worker isolado, sem privilégios, com timeout e limites de recursos;
- preferir storage privado com URLs assinadas por objeto, em vez de Blob público.

Critério de aceite: todos os endpoints de criação/agendamento rejeitam URLs não emitidas pelo sistema; testes cobrem localhost, metadata, redirects, DNS rebinding, arquivo excedente e lote excessivo.

### P0.5 Fechar CORS e configuração de produção

Evidência: `src/server.js:52-57` usa `origin: true` quando `FRONTEND_ORIGIN` está vazio. `src/config/env.js:35-45` exige somente `AUTH_TOKEN_SECRET`, `TOKEN_ENCRYPTION_KEY` e `DATABASE_URL` em produção.

Risco: qualquer origem pode ler respostas CORS quando a configuração está incompleta; um deploy sem `NODE_ENV=production`, `SESSION_SECRET`, `FRONTEND_URL`, `BASE_URL` ou `CRON_SECRET` pode iniciar com postura insegura ou quebrar controles críticos.

Ações:

- exigir `NODE_ENV=production` no deploy;
- fazer startup fail-closed se `FRONTEND_ORIGIN` estiver ausente, contiver wildcard ou tiver origem que não seja HTTPS em produção;
- validar e exigir todas as variáveis realmente usadas: URLs HTTPS, segredos, credenciais OAuth, cron, storage, e-mail e provedores de IA conforme funcionalidade habilitada;
- remover `Access-Control-Allow-Origin: *` e permitir somente origens exatas;
- separar segredos por ambiente e provedor, com rotação documentada;
- impedir que endpoints de configuração retornem qualquer segredo. `GOOGLE_API_KEY` em `src/server.js:220-223` deve ser removida da resposta ou restringida no Google Cloud por origem, API e quota.

Critério de aceite: deploy de produção falha com configuração incompleta; teste de origem não autorizada recebe ausência de CORS e não consegue ler dados.

## P1 — concluir antes de considerar a aplicação endurecida

### P1.1 Sessões, autenticação e recuperação de conta

- Substituir o HMAC customizado de sessão por mecanismo de sessão conhecido ou, se mantido temporariamente, adicionar `aud`, `iss`, tipo/purpose obrigatório, `jti`, validação estrita de `userId` inteiro, rotação, revogação e limite de idade.
- Fazer `logout`, troca de senha e reset de senha invalidarem sessões; atualmente `atualizarSenha` e `atualizarSenhaPorResetToken` não fazem isso.
- Guardar somente o hash do token de reset no banco, com uso único, TTL curto, limitação por IP e por conta, e resposta uniforme.
- Aumentar a senha mínima para pelo menos 12 caracteres, bloquear senhas comprometidas/reutilizadas e migrar progressivamente para Argon2id ou bcrypt com custo calibrado; o atual limite de 6 caracteres e custo 10 é baixo para um objetivo de segurança máxima.
- Evitar enviar a senha para integrações de terceiros sem necessidade. Documentar o fluxo `meuEcoo`, minimizando dados, escopos e retenção.
- Usar OIDC com biblioteca validada para Google, validando issuer, audience, `email_verified`, nonce, state de uso único e PKCE quando suportado.

### P1.2 TOTP, WebAuthn e recuperação forte

Evidências: `src/routes/me.js:131-174` e `src/routes/auth.js:150-171` permitem setup/enable/disable/validação, mas os endpoints de setup, enable e disable não têm limitador específico; `validarCodigo` aceita janela de ±30 segundos.

Ações:

- aplicar rate limit por IP, usuário e dispositivo em login 2FA, reset por 2FA, enable e disable;
- impedir reutilização do mesmo contador TOTP e registrar tentativas falhas;
- exigir senha atual/reautenticação recente para setup e disable, além do código;
- fornecer códigos de recuperação de uso único, armazenados somente em hash;
- considerar WebAuthn/passkeys para administradores e operações sensíveis;
- separar a chave de criptografia TOTP da chave dos tokens OAuth e controlar acesso ao KMS.

### P1.3 Autorização e isolamento multi-tenant

A aplicação filtra muitos repositórios por `user_id`, porém administradores recebem acesso amplo e o isolamento depende de disciplina de cada query.

Ações:

- ativar Row-Level Security no PostgreSQL para `contas`, `tokens`, `posts`, `post_accounts`, drafts, logs, IA e históricos;
- usar usuário de banco sem `SUPERUSER`, sem `CREATE` no schema da aplicação e com TLS verificado;
- separar conexão de migração, aplicação, worker e leitura administrativa;
- criar funções de autorização centralizadas para owner, admin e super-admin; não aceitar `isAdmin` espalhado sem justificativa;
- manter tokens/credenciais de outros usuários fora das telas normais de admins; criar fluxo break-glass com justificativa, reautenticação, MFA e auditoria;
- exigir transação e lock ao alterar papel/ativo, impedir corrida que deixe o sistema sem super-admin e invalidar sessões do usuário alterado;
- adicionar testes negativos sistemáticos: usuário A não pode ler, alterar, renovar, excluir ou publicar usando qualquer ID de B.

### P1.4 Rate limiting, quotas e proteção contra abuso

Hoje o limitador cobre principalmente login e forgot-password. Adicionar limites distribuídos, usando Redis ou store compartilhado, para:

- todas as rotas públicas e `/api` por IP, usuário e operação;
- registro, login, 2FA, reset, OAuth start/callback e webhooks;
- upload URL, criação/agendamento/publicação, renovação e exclusão de tokens;
- IA, análise de mídia, geração de imagem, teste de API key e agente;
- envio de push, comentários e operações administrativas.

Também implementar quota por tenant para uploads, posts, chamadas externas, custo de IA, número de contas e tamanho de históricos. O contador diário de IA deve ser atômico e transacional; o código atual usa operações best-effort em partes do fluxo.

### P1.5 OAuth, callbacks e webhooks

- Tornar `state` de OAuth de uso único e vinculado à sessão/navegador, além da assinatura; armazenar hash e expiração no servidor.
- Validar rigorosamente `redirect_uri`, origem e parâmetros; nunca construir JavaScript com interpolação de URL.
- Corrigir os sinks HTML em `src/routes/oauth.js:128-133` e `:856-858`: escapar dados ou, preferencialmente, responder JSON/página estática sem interpolação.
- A resposta de erro do callback Meta em `src/routes/oauth.js:847-850` deve ser genérica, sem `err.message`.
- Usar idempotency key/event ID nos webhooks e rejeitar replay; o timestamp do TikTok limita a janela, mas não impede repetição dentro dela.
- Validar tamanho, content type e estrutura do body bruto antes de processar webhook.
- Testar assinatura inválida, payload duplicado, timestamp futuro, replay, body truncado e falhas de provedor.

### P1.6 API keys da IA e privacidade de dados

As chaves de usuário são cifradas em `src/routes/ai.js:96-104` e `:1021-1033`, o que é positivo. Ainda assim:

- usar uma chave KMS separada para chaves de IA e rotação por versão;
- validar modelos por allowlist em todas as rotas, limitar tamanho/formato da chave e nunca retornar mais que os últimos quatro caracteres;
- aplicar rate limit no `/apikey/test`, pois ele pode gerar custo e testar chaves de terceiros;
- documentar quais textos, posts, comentários, mídias e dados analíticos são enviados a cada provedor;
- oferecer opt-out, retenção mínima e remoção de histórico de chat/memória;
- tratar conteúdo de posts/comentários como dado não confiável: prompt injection não pode alterar catálogo, autorização ou confirmação;
- manter ações do agente em allowlist server-side, com argumentos revalidados na execução, confirmação ligada ao usuário e aprovação de uso único, não apenas token assinado reutilizável por cinco minutos;
- nunca permitir que a IA escolha usuário, conta, token, provedor ou destino fora do contexto autenticado.

## P2 — hardening de aplicação e navegador

### Cabeçalhos e políticas web

Substituir os cabeçalhos manuais incompletos por `helmet` configurado ou política equivalente:

- CSP estrita com nonce/hash, sem `unsafe-eval` e evitando `unsafe-inline`;
- `Strict-Transport-Security` somente em produção HTTPS, com tempo adequado e preload apenas após validação;
- `Content-Security-Policy`, `Permissions-Policy`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` e `X-Content-Type-Options`;
- `Cache-Control: no-store` para login, reset, respostas autenticadas, media proxy e qualquer resposta com dados pessoais;
- `X-Frame-Options: DENY` ou CSP `frame-ancestors 'none'`, mantendo exceções somente se um fluxo realmente exigir iframe;
- não expor stack trace, SQL, IDs internos ou respostas de provedores.

### Validação de entrada e saída

- Adotar schema validation centralizada com Zod, Ajv ou Joi para body, query e params; limitar strings, arrays, objetos JSON e profundidade.
- Validar `platform`, status, IDs, datas, timezone, URLs, nomes, captions, comentários, configurações e campos por rede tanto no frontend quanto no servidor.
- Paginar todas as listagens; evitar `LIMIT` alto e `OFFSET` arbitrário em chat/logs.
- Usar respostas com DTOs explícitos: nunca retornar colunas de tokens, segredos, TOTP, reset ou JSON operacional por acidente.
- Escapar toda saída HTML. O status de data deletion usa `req.query.id` diretamente no HTML e deve ser convertido em texto seguro.
- Definir `Content-Disposition` e tipos permitidos para mídia; impedir upload de HTML/SVG ativo ou servi-lo com `Content-Type` seguro.

### Upload e armazenamento

- Associar cada objeto de storage a usuário, post, finalidade, MIME detectado, tamanho, checksum e expiração.
- Fazer limpeza de uploads órfãos e reter somente o necessário.
- Verificar malware, imagens decompression bombs e metadados EXIF quando o risco/volume justificar.
- Não usar `public` como padrão para material de usuário; entregar URLs assinadas de curta duração.
- No media proxy, usar allowlist exata, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, timeout, limite de bytes e stream abortável.

## P3 — infraestrutura, operação e governança

### Banco e execução

- Corrigir `src/db/pool.js:8-18`: `ssl.rejectUnauthorized` não deve ser `false`; instalar a CA do provedor e validar certificado.
- Configurar `statement_timeout`, `query_timeout`, limites de pool por processo e circuit breaker para dependências externas.
- Tirar migrações do caminho de inicialização do servidor. `src/db/runtimeMigrations.js:3-6` ignora falhas individuais e pode iniciar uma versão com schema incompleto; usar pipeline versionado, lock/advisory lock e abortar deploy quando migration falhar.
- Usar transações nas operações compostas de criar post, vincular contas, apagar conta e persistir token.
- Fazer backup criptografado, restore testado, PITR, segregação de acesso e retenção definida.

### Docker e supply chain

- Executar o container como usuário não root, filesystem read-only quando possível, capabilities mínimas, seccomp/AppArmor e limites de CPU/memória.
- Fixar imagens base por digest e atualizar Node regularmente.
- Gerar SBOM, assinar artefatos, escanear imagem e lockfile no CI e bloquear vulnerabilidades críticas/altas.
- Usar `npm ci --omit=dev` e remover ferramentas/arquivos desnecessários da imagem final.
- Confirmar que `.env`, backups, dumps e artefatos de desenvolvimento nunca entram na imagem ou no build context.
- Separar web, worker de publicação e cron para limitar blast radius e impedir jobs duplicados.

### Observabilidade e resposta

- Centralizar logs estruturados com request ID, user ID pseudonimizado, rota, status, latência e resultado; nunca corpo completo, Authorization, cookies ou tokens.
- Criar alertas para login anômalo, falhas de MFA, reset, mudança de papel, conexão/renovação de conta, publicação em massa, SSRF bloqueado, pico de IA e erro de webhook.
- Criar trilha de auditoria imutável para ações administrativas e operações sobre credenciais.
- Definir processo de incidente: revogar sessões, rotacionar chaves, invalidar tokens OAuth, bloquear tenant, preservar evidências e notificar titulares quando aplicável.
- Executar DAST autenticado, SAST, secret scanning, dependency scanning, container scanning e pentest anual/antes de mudanças de autenticação ou isolamento.

## Ordem de implementação sugerida

1. Desligar/remover bypass de revisão, corrigir configuração fail-closed e CORS.
2. Remover tokens de logs e de `instagram_pending`; rotacionar credenciais potencialmente expostas.
3. Fechar todos os caminhos de mídia e executar conversão/probe isolados com limites.
4. Migrar para cookie de sessão HttpOnly e fluxo OAuth com código de uso único.
5. Revogar sessões em logout, troca/reset de senha e alteração administrativa; endurecer senha e MFA.
6. Aplicar rate limits/quotas distribuídos e validação de schemas em todas as rotas.
7. Ativar RLS, corrigir TLS do PostgreSQL, separar papéis de banco e retirar migrações best-effort.
8. Endurecer IA, webhooks, headers, storage privado, Docker e pipeline de supply chain.
9. Rodar testes de autorização multi-tenant, DAST e pentest com dados sintéticos.

## Checklist de aceite para produção

- [ ] Nenhuma rota de dados funciona sem autenticação válida.
- [ ] Sessão não está em URL, storage acessível por JavaScript ou logs.
- [ ] Logout, reset, troca de senha e desativação revogam sessões.
- [ ] Nenhum access/refresh token aparece em logs, tabelas de estado ou respostas HTTP.
- [ ] CORS permite somente origens HTTPS explicitamente cadastradas.
- [ ] SSRF, redirects, DNS rebinding e downloads sem limite estão cobertos por testes.
- [ ] Uploads têm assinatura de arquivo, quota, scan e URL privada/assinada.
- [ ] MFA tem rate limit, recovery codes, reautenticação e auditoria.
- [ ] Cada query sensível possui isolamento por tenant e há RLS no banco.
- [ ] PostgreSQL valida certificado TLS e usa credencial sem privilégios excessivos.
- [ ] Rate limits e quotas funcionam entre réplicas/instâncias.
- [ ] Webhooks são autenticados, idempotentes e protegidos contra replay.
- [ ] IA não consegue executar ação fora do catálogo/contexto nem reutilizar aprovação.
- [ ] CI bloqueia secrets, vulnerabilidades críticas/altas, imagem insegura e testes negativos quebrados.
- [ ] Backup, restauração e plano de resposta a incidente foram testados.
