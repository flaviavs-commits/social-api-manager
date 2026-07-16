# Roteiro detalhado do vídeo de demonstração — Verificação OAuth Google

Este vídeo é OBRIGATÓRIO para a verificação dos escopos restritos do YouTube
(`youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`).

## Requisitos técnicos do vídeo (exigências do Google)

- **Idioma**: pode ser em português, mas o Google prefere inglês ou legendas
  em inglês. Se gravar narrando em português, adicione legendas em inglês.
- **Duração**: 3 a 6 minutos. Sem cortes que escondam etapas.
- **Onde hospedar**: suba no YouTube como **"Não listado"** (unlisted) e cole o
  link no formulário de verificação.
- **Mostrar a barra de URL** do navegador em TODAS as telas, especialmente na
  tela de consentimento do Google (o revisor precisa ver `accounts.google.com`
  e depois o domínio do seu app `social-api-manager.vercel.app`).
- **Usar uma conta Google real** que NÃO seja a conta de desenvolvedor/dono do
  projeto (o Google quer ver o fluxo como um usuário comum o veria).
- **Não acelerar nem cortar** a tela de consentimento — ela deve aparecer
  inteira, legível, com os 3 escopos do YouTube visíveis.

---

## Roteiro cena a cena

### Cena 1 — Apresentação do app (~20s)
- Abra `https://social-api-manager.vercel.app` no navegador, com a barra de URL
  visível.
- Faça login no app (e-mail/senha).
- Narração/legenda sugerida:
  > "This is Social Api Manager, a dashboard that lets a user schedule and
  > publish content to their own social media accounts — including YouTube —
  > from a single place."

### Cena 2 — Iniciar a conexão da conta do YouTube (~40s) — escopo em foco: TODOS
- No menu lateral, clique em **"Conexões das Contas"**.
- Localize o card do **YouTube** e clique em **"+ Conta"**.
- Mostre o redirecionamento para `accounts.google.com` (deixe a URL visível).
- Narração/legenda:
  > "To connect a YouTube channel, the user starts the Google OAuth flow."

### Cena 3 — Tela de consentimento do Google (~30s) — CRÍTICA
- **Pare e deixe a tela de consentimento totalmente visível.**
- Mostre claramente os três escopos sendo solicitados:
  - "See, edit, and permanently delete your YouTube videos, ratings, comments and captions" / **Manage your YouTube account** (`youtube.upload`)
  - **View your YouTube account** (`youtube.readonly`)
  - **View YouTube Analytics reports** (`yt-analytics.readonly`)
- Clique em permitir/continuar e aceite.
- Narração/legenda:
  > "Google shows exactly which permissions are requested. The user reviews
  > and grants them."

### Cena 4 — Conta conectada (~20s) — escopo: youtube.readonly
- Volte ao app, já com a conta do YouTube aparecendo conectada no card.
- Mostre o nome do canal aparecendo (isso já usa `youtube.readonly` para ler
  os dados do canal).
- Narração/legenda:
  > "After granting access, the app reads basic channel info (youtube.readonly)
  > to display the connected account."

### Cena 5 — Publicar um vídeo (~60s) — escopo: youtube.upload
- No menu, clique em **"Programar Post"**.
- Crie um post novo: escreva um título/descrição, selecione a plataforma
  **YouTube**, e anexe um vídeo curto de teste.
- Publique (ou agende e dispare a publicação).
- Mostre a confirmação de envio.
- Narração/legenda:
  > "The core feature: the user uploads a video to their own YouTube channel
  > directly from the app. This uses the youtube.upload scope."

### Cena 6 — Status do vídeo publicado (~30s) — escopo: youtube.readonly
- Vá em **"Histórico de Atividades"** (ou onde aparecem as notificações) e
  mostre o status do vídeo mudando para "publicado / disponível no YouTube",
  obtido lendo a API.
- Opcional: abra o vídeo no YouTube em outra aba para provar que foi publicado.
- Narração/legenda:
  > "The app checks the upload status through the API (youtube.readonly) and
  > confirms to the user when the video is live, without leaving the dashboard."

### Cena 7 — Métricas / Analytics (~40s) — escopo: yt-analytics.readonly
- Vá em **"Analytics"**.
- Mostre as métricas do vídeo publicado, incluindo o **tempo médio de
  visualização** (average view duration), que vem da YouTube Analytics API.
- Narração/legenda:
  > "Finally, the app displays performance metrics for the user's own videos,
  > including average view duration, fetched via yt-analytics.readonly. Only
  > the authenticated user's own channel data is accessed."

### Cena 8 — Revogar acesso / desconectar (~20s)
- Volte em **"Conexões das Contas"** e mostre o botão **"Excluir"** numa conta
  conectada → mostre o modal de confirmação.
- Narração/legenda:
  > "The user has full control and can disconnect the account at any time,
  > which removes the stored access token."

---

## Checklist antes de enviar o link

- [ ] Vídeo subido no YouTube como "Não listado"
- [ ] Barra de URL visível em todas as telas
- [ ] Tela de consentimento do Google aparece inteira e legível
- [ ] Os 3 escopos do YouTube foram demonstrados em uso real (upload, status, analytics)
- [ ] Legendas em inglês (se a narração for em português)
- [ ] Link do vídeo colado no formulário de verificação do Google Cloud Console
