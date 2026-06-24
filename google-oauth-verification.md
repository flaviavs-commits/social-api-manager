# Material para verificação do app no Google Cloud Console

App: Social API Manager — ferramenta de gerenciamento e publicação de posts
em múltiplas redes sociais (Instagram, TikTok, YouTube, Kwai, Facebook).

## Escopos solicitados e por que cada um é necessário

### `https://www.googleapis.com/auth/youtube.upload`
**Uso no código:** publicação de vídeos no canal do usuário (src/services/publisher.js,
fluxo de post agendado/imediato para a plataforma "youtube").
**Justificativa para o formulário:**
> O app permite que o usuário agende e publique vídeos diretamente no próprio
> canal do YouTube a partir de uma interface central, junto com outras redes
> sociais. Sem este escopo, o usuário precisaria fazer upload manualmente no
> YouTube depois de já ter preparado o post no app — o escopo elimina essa
> etapa duplicada.

### `https://www.googleapis.com/auth/youtube.readonly`
**Uso no código:** leitura de dados do canal/vídeo após a publicação (status de
processamento do vídeo, metadados) — ver `youtube_video_ready` em
src/services/scheduler.js e o evento equivalente no frontend.
**Justificativa para o formulário:**
> Após o upload, o app consulta a API para saber quando o vídeo terminou de
> processar no YouTube e exibir essa confirmação ao usuário dentro do próprio
> painel, sem precisar checar manualmente no YouTube Studio.

### `https://www.googleapis.com/auth/yt-analytics.readonly`
**Uso no código:** `metricsYoutubeWatchTime` em src/services/metricsService.js —
busca o tempo médio de visualização (`averageViewDuration`) de cada vídeo
publicado pelo app.
**Justificativa para o formulário:**
> O app exibe ao usuário, junto com os posts publicados, métricas de
> desempenho (visualizações, curtidas, tempo médio de visualização) agregadas
> de todas as redes conectadas em um único painel. Esse escopo é usado
> apenas para leitura agregada de métricas do próprio canal do usuário
> autenticado, nunca de canais de terceiros.

## Itens a preparar antes de submeter

- [ ] **Domínio verificado** no Google Search Console com o domínio de produção
      (ex: social-api-manager.vercel.app) — necessário antes de publicar o app.
- [ ] **Política de Privacidade** publicamente acessível (já existe:
      https://flaviavs-commits.github.io/social-manager-privacy/privacy.html)
      — confirmar que ela menciona especificamente a coleta/uso de dados do
      YouTube (escopos usados, finalidade, retenção, como revogar acesso).
- [ ] **Termos de Uso** publicamente acessíveis (verificar se existe; se não,
      precisa ser criado antes da submissão).
- [ ] **Logo do app** carregado na tela de consentimento OAuth (192x192px mín.).
- [ ] **Nome do app e e-mail de suporte** preenchidos na OAuth consent screen.
- [ ] **Authorized domains** incluindo o domínio de produção.

## Roteiro do vídeo de demonstração (obrigatório para escopos restritos)

O Google exige um vídeo mostrando o fluxo completo de consentimento e o uso
real de cada escopo sensível/restrito. Roteiro sugerido (3-5 min, gravação de
tela com narração ou legendas):

1. **Login no app** (mostrar a tela inicial, sem estar logado).
2. **Iniciar conexão da conta do YouTube**: clicar em "+ Conta" na seção
   YouTube → mostrar o redirecionamento para a tela de consentimento do
   Google → mostrar a tela listando exatamente os escopos pedidos
   (upload, readonly, analytics) → aceitar.
3. **Voltar ao app já com a conta conectada**: mostrar o card do YouTube
   atualizado com a conta vinculada.
4. **Demonstrar o uso do escopo `youtube.upload`**: criar um post novo,
   selecionar a plataforma YouTube, anexar um vídeo de teste curto, publicar.
5. **Demonstrar o uso do escopo `youtube.readonly`**: mostrar o status do
   vídeo mudando para "publicado"/"disponível" no painel de logs/notificações
   do app, sem precisar abrir o YouTube Studio.
6. **Demonstrar o uso do escopo `yt-analytics.readonly`**: abrir a página de
   métricas do post publicado e mostrar o tempo médio de visualização sendo
   exibido, vindo da YouTube Analytics API.
7. **Encerrar mostrando a opção de desconectar a conta** (botão "Excluir"
   implementado na página de conexões) — demonstra que o usuário tem
   controle total para revogar o acesso quando quiser.

## Observação sobre CASA (Tier 2)

`youtube.upload` é classificado pelo Google como escopo restrito, o que pode
acionar a exigência de avaliação de segurança CASA (Certificação de
Segurança de Apps), dependendo do número de usuários/instalações declarado.
Isso é decidido pelo próprio Google durante a análise — não há ação prévia
necessária além de responder ao formulário de verificação com honestidade
sobre o volume de uso esperado.
