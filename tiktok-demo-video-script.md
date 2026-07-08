# Roteiro do vídeo de demonstração — App Review do TikTok

Este vídeo é a peça central para reverter a reprovação do TikTok. Os motivos
apontados pelo revisor foram:

1. **"Demo video should show the complete end-to-end flow of the integrations
   with TikTok (Please demonstrate with sandbox or provide a mockup demo)."**
2. **"App name different from website."**
3. **"Website must be fully developed."**
4. **"Demo video does not provide enough clarity and context as to show the
   website functions."**

O roteiro abaixo foi desenhado para atender aos 4 pontos de uma vez.

---

## Antes de gravar — checklist de pré-condições

- [ ] **Nome consistente**: o app agora se chama **"Social Api Manager"** no
      site, no backend e no `docs/app-info.json`. **Confirme que o campo
      "App name" no TikTok Developer Portal também está como
      `Social Api Manager`** (o mesmo texto, com espaços e maiúsculas). Se
      estiver como `social-api-manager`, edite no portal para bater com o site.
      → resolve o motivo #2.
- [ ] **Site completo**: percorra `https://social-api-manager.vercel.app`
      antes de gravar e garanta que Dashboard, Conexões, Programar Post,
      Analytics e as páginas Sobre/Termos/Privacidade abrem sem erro.
      → resolve o motivo #3.
- [ ] **Sandbox do TikTok**: use uma conta de teste (target user) adicionada em
      *Sandbox* no TikTok Developer Portal. O revisor pediu explicitamente
      sandbox ou mockup. Conecte essa conta sandbox ao app antes de gravar.
- [ ] **Barra de URL visível** em todas as telas (mostra `tiktok.com` no
      consentimento e `social-api-manager.vercel.app` no app).
- [ ] **Um vídeo de teste curto** (5–15s, MP4) pronto para publicar.
- [ ] Gravação em **1080p**, sem cortes que escondam etapas. Duração 3–5 min.
- [ ] Narração/legenda **em inglês** (o revisor do TikTok trabalha em inglês).

---

## Roteiro cena a cena

### Cena 1 — Apresentação do app e do site (~30s) → motivos #3 e #4
- Abra `https://social-api-manager.vercel.app` com a barra de URL visível.
- Mostre a página inicial / faça login e chegue ao **Dashboard**.
- Passe rapidamente pelo menu lateral mostrando que o site é real e completo:
  **Dashboard, Conexões das Contas, Programar Post, Analytics, Histórico**.
- Narração:
  > "This is Social Api Manager, available at social-api-manager.vercel.app.
  > It's a dashboard that lets a user schedule and publish content to their own
  > social accounts, including TikTok, from one place. The app name here matches
  > the name registered in the TikTok developer portal."

### Cena 2 — Conectar a conta do TikTok (OAuth) (~50s) → fluxo end-to-end
- Vá em **"Conexões das Contas"**.
- No card do **TikTok**, clique em **"+ Conta"**.
- Mostre o redirecionamento para **`tiktok.com`** (deixe a URL visível) e a
  tela de autorização do TikTok com os escopos solicitados.
- Faça login com a **conta sandbox de teste** e autorize.
- Volte ao app já com a conta TikTok conectada (nome e avatar aparecendo —
  isso usa `user.info.basic` e `user.info.profile`).
- Narração:
  > "To connect a TikTok account, the user starts the TikTok OAuth flow.
  > TikTok shows the requested permissions. After the user grants them, the
  > app displays the connected account's name and avatar."

### Cena 3 — Publicar um vídeo no TikTok (~70s) → CRÍTICA, fluxo end-to-end
- Vá em **"Programar Post"**.
- Crie um post: escreva a legenda, selecione a plataforma **TikTok**, e anexe o
  **vídeo de teste**.
- Publique (ou agende e dispare a publicação).
- Mostre a **confirmação de envio** no app (isso usa `video.upload` e
  `video.publish`).
- Narração:
  > "The core feature: the user uploads a video to their own TikTok account
  > directly from the dashboard. This uses the video.upload and video.publish
  > scopes. Here is the upload being sent to the sandbox account."

### Cena 4 — Confirmar a publicação e listar vídeos (~40s) → fluxo end-to-end
- Vá em **"Histórico de Atividades"** e mostre o evento de publicação
  bem-sucedida.
- Volte ao Dashboard/perfil da conta e mostre o vídeo aparecendo na lista de
  vídeos publicados (usa `video.list`).
- (Opcional, forte) Abra a conta sandbox no TikTok em outra aba e mostre o
  vídeo publicado lá, provando o fluxo completo ponta a ponta.
- Narração:
  > "The app confirms the publication in the activity log and lists the user's
  > published videos using video.list. Here is the same video now live on the
  > connected TikTok sandbox account."

### Cena 5 — Analytics do TikTok (~30s)
- Vá em **"Analytics"**.
- Mostre as métricas da conta TikTok (seguidores/curtidas — usa
  `user.info.stats`).
- Narração:
  > "The Analytics screen shows follower and like statistics for the user's own
  > connected account, using user.info.stats. Only the authenticated user's own
  > account data is accessed."

### Cena 6 — Desconectar a conta (~20s)
- Volte em **"Conexões das Contas"**, clique em **"Excluir"** na conta TikTok e
  mostre o modal de confirmação.
- Narração:
  > "The user has full control and can disconnect the account at any time,
  > which removes the stored access token."

---

## Mapeamento: cada escopo aparece em uso no vídeo

| Escopo do TikTok    | Onde aparece no vídeo                              |
|---------------------|---------------------------------------------------|
| `user.info.basic`   | Cena 2 — conta conectada (nome)                   |
| `user.info.profile` | Cena 2 — avatar/nome de exibição                  |
| `user.info.stats`   | Cena 5 — Analytics (seguidores/curtidas)          |
| `video.list`        | Cena 4 — lista de vídeos publicados               |
| `video.upload`      | Cena 3 — upload do vídeo                           |
| `video.publish`     | Cena 3 — publicação do vídeo                       |

Mostrar cada escopo em uso real é o que o revisor precisa ver para aprovar.

---

## Checklist antes de reenviar

- [ ] Nome "Social Api Manager" igual no site **e** no App name do portal
- [ ] Vídeo mostra o fluxo TikTok completo: conectar → publicar → confirmar →
      analytics → desconectar
- [ ] Fluxo demonstrado com **conta sandbox** do TikTok
- [ ] Barra de URL visível em todas as telas
- [ ] Todos os 6 escopos aparecem em uso real
- [ ] Narração/legenda em inglês, sem cortes escondendo etapas
- [ ] Vídeo hospedado (YouTube "Não listado" ou upload direto) e link colado no
      formulário de reenvio do TikTok
- [ ] Campos "Website URL" e "App name" atualizados no formulário do TikTok
