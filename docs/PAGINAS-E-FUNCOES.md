# Páginas e funções do Meu Ecoo Mídia

Documento funcional e técnico das telas disponíveis no frontend. A finalidade é explicar o que cada página resolve para o usuário, quais ações oferece, quais dados utiliza e como se relaciona com os demais módulos.

## 1. Visão geral do produto

O Meu Ecoo Mídia é um gerenciador de redes sociais. O fluxo principal é:

1. Criar uma conta ou entrar.
2. Conectar Instagram, Facebook, YouTube e/ou TikTok.
3. Criar, revisar, salvar, agendar ou publicar conteúdo.
4. Acompanhar calendário, histórico, comentários e métricas reais.
5. Organizar mídias, rotinas recorrentes, equipe e links públicos.

O frontend usa navegação interna em `/app/<modulo>`. O `App` em `frontend/src/main.jsx` identifica a URL, busca o usuário atual e entrega as páginas dentro do `AppShell`.

## 2. Mapa de rotas

| URL | Página | Finalidade |
|---|---|---|
| `/` | Landing page | Apresentar o produto e direcionar para login/painel. |
| `/login.html` | Login e cadastro | Entrar, criar conta, recuperar senha e concluir 2FA. |
| `/reset-password.html` | Redefinição de senha | Validar token e criar nova senha. |
| `/verify-2fa.html` | Verificação 2FA | Confirmar o código temporário após o login. |
| `/app.html` | Dashboard | Visão geral da operação do usuário. |
| `/app/agendador` | Criador de Posts | Produzir, revisar, salvar, agendar e publicar posts. |
| `/app/calendario` | Calendário | Visualizar e reagendar publicações. |
| `/app/rascunhos` | Rascunhos | Salvar e retomar conteúdos ainda não publicados. |
| `/app/analytics` | Analytics | Analisar desempenho real das redes e publicações. |
| `/app/inbox` | Inbox | Acompanhar e responder comentários/interações. |
| `/app/integracoes` | Contas conectadas | Conectar, reconectar e desconectar redes sociais. |
| `/app/tokens` | Tokens | Consultar, renovar e revogar credenciais de integração. |
| `/app/seguranca` | Segurança | Configurar ou remover autenticação em dois fatores. |
| `/app/atividade` | Atividades | Consultar e limpar o histórico operacional. |
| `/app/ai` | Assistente IA | Gerar ideias, imagens, análises e publicações assistidas. |
| `/app/perfil` | Perfil | Editar dados pessoais, senha, avatar, preferências e sessões. |
| `/app/biblioteca` | Biblioteca de mídia | Armazenar, buscar, organizar e reutilizar arquivos. |
| `/app/filas` | Filas recorrentes | Criar rotinas automáticas de publicação. |
| `/app/smartlinks` | Smartlinks | Criar páginas públicas de links rastreáveis. |
| `/app/equipe` | Equipe | Organizar clientes/marcas, membros, aprovações e identidade visual. |
| `/admin.html` | Administração | Gerenciar usuários, papéis e situação das contas. |

`/app/automacoes` não faz parte do conjunto atual de módulos ativos. Existe uma compatibilidade que redireciona essa URL para o dashboard.

## 3. Estrutura compartilhada

### `AppShell`

Arquivo: `frontend/src/components/layout/app-shell.jsx`

É a moldura das páginas autenticadas. Ela fornece:

- Menu lateral com todas as áreas do produto.
- Topbar com página atual, tema, atalhos, notificações, criação rápida e perfil.
- Navegação mobile inferior.
- Botão de recolher/expandir sidebar.
- Logout.
- Atalhos de teclado: `C` para criar post, `D` para dashboard, `?` para ajuda e `Esc` para fechar janelas.
- Widget do Assistente IA disponível durante a navegação.

### Navegação e carregamento

`frontend/src/main.jsx` controla:

- A seleção da tela conforme a URL.
- O redirecionamento de módulos não disponíveis.
- A busca de `/api/me` para preencher usuário e avatar.
- O histórico do navegador com `pushState` e `popstate`.
- O carregamento inicial do tema.

`frontend/src/pages/module-page.jsx` carrega os módulos com `lazy`/`Suspense`, reduzindo o bundle inicial. Se um tipo não possuir página registrada, exibe um placeholder de módulo.

## 4. Páginas públicas e autenticação

### 4.1 Landing page

Arquivo: `frontend/src/pages/landing-page.jsx`

**Para que serve:** apresentar o Meu Ecoo Mídia antes do login.

**Funções de negócio:**

- Explicar a proposta de conectar, criar, agendar e crescer.
- Direcionar o visitante para login/cadastro.
- Disponibilizar links institucionais, como privacidade e termos.

Não consulta dados privados nem cria registros.

### 4.2 Login e cadastro

Arquivo: `frontend/src/pages/auth-page.jsx` — componente `LoginPage`.

**Para que serve:** controlar a entrada e a criação de contas.

**Funções:**

- Alternar entre entrar e criar conta.
- Validar formato de e-mail.
- Aplicar regras básicas de senha no cadastro.
- Fazer login.
- Criar conta com nome opcional.
- Continuar com Google.
- Solicitar recuperação de senha.
- Confirmar código 2FA durante o login.
- Iniciar o fluxo de recuperação de 2FA.
- Redirecionar para o painel após autenticação.

**APIs principais:**

- `POST /auth/login/login`
- `POST /auth/login/register`
- `POST /auth/login/verify-2fa`
- `POST /auth/login/reset-2fa`
- `POST /auth/login/forgot-password`
- `GET /auth/login/google` via link de OAuth.

### 4.3 Redefinição de senha

Arquivo: `frontend/src/pages/auth-page.jsx` — componente `ResetPasswordPage`.

**Para que serve:** trocar a senha a partir do token recebido por e-mail.

**Funções:**

- Ler o token da URL.
- Validar se o token ainda é utilizável.
- Exibir as regras de senha em tempo real.
- Confirmar a senha duas vezes.
- Salvar a nova senha.
- Voltar para o login.

**APIs:**

- `GET /auth/login/reset-password/validar?token=...`
- `POST /auth/login/reset-password`

### 4.4 Verificação em dois fatores

Arquivo: `frontend/src/pages/auth-page.jsx` — componente `VerifyTwoFactorPage`.

**Para que serve:** concluir o login quando o usuário possui 2FA ativo.

**Funções:**

- Aceitar somente código numérico de seis dígitos.
- Confirmar o código.
- Redirecionar para `/app.html` quando válido.
- Exibir erro sem revelar informações sensíveis.

**API:** `POST /auth/login/verify-2fa`.

## 5. Dashboard

Arquivo: `frontend/src/pages/dashboard-page.jsx`

**Para que serve:** oferecer uma visão operacional rápida da conta autenticada.

**Dados carregados:**

- Publicações em `GET /api/posts`.
- Contas em `GET /api/accounts`.
- Métricas em `GET /api/posts/analytics` (7 dias por padrão; `days` é opcional).

**Funções para usuários com dados:**

- Mostrar total de publicações.
- Mostrar publicações agendadas.
- Mostrar falhas e permitir revisão no editor.
- Mostrar total de contas conectadas e redes ativas.
- Exibir performance dos últimos 7 dias por padrão.
- Exibir visualizações, interações, taxa de interação e tendência diária.
- Sugerir conteúdo com base no melhor post real.
- Sugerir horário com base nos dados disponíveis.
- Listar publicações recentes com busca e filtros por status.
- Mostrar próximos agendamentos.
- Mostrar redes conectadas e atalhos para gerenciá-las.

**Estado inicial sem dados:**

Quando não há contas nem publicações, a tela mostra apenas um estado vazio limpo. Não são exibidos números, gráficos, rankings, insights ou dados demonstrativos. O usuário recebe ações para:

- Conectar a primeira conta.
- Criar a primeira publicação.

O checklist de onboarding continua orientando a sequência inicial.

**Funções auxiliares relevantes:**

- `failureDiagnosis`: classifica uma falha como sistema, rede/conexão, conteúdo/configuração ou origem inconclusiva.
- `bestObservedHour` e `bestProviderTime`: calculam uma janela de horário somente quando existem dados reais.
- `reviewFailure`: reaproveita o conteúdo que falhou no editor.

## 6. Operação de conteúdo

### 6.1 Criador de Posts

Arquivo: `frontend/src/pages/scheduler-page.jsx`

**Para que serve:** ser o centro de criação e publicação multiplataforma.

**Funções:**

- Escrever texto por plataforma.
- Escolher Instagram, Facebook, YouTube e TikTok.
- Escolher contas conectadas específicas.
- Publicar imediatamente ou agendar.
- Fazer upload de imagens e vídeos.
- Pré-visualizar o conteúdo por rede.
- Configurar título, visibilidade, categoria e público infantil no YouTube.
- Configurar formato do Instagram.
- Configurar privacidade e restrições de comentários, duetos e stitches no TikTok.
- Adicionar primeiro comentário quando suportado.
- Usar mídia da biblioteca.
- Aplicar análise de imagem/vídeo com IA.
- Receber sugestões de legenda, hashtags e estrutura.
- Salvar rascunho local e autosave no servidor.
- Salvar conteúdo como modelo.
- Acompanhar progresso da publicação e eventos do backend.
- Exibir erros por etapa, sem perder o conteúdo digitado.

**APIs principais:**

- `GET /api/accounts`
- `POST /api/posts/upload-url`
- `POST /api/posts`
- `GET/POST/PATCH/DELETE /api/drafts...`
- `GET /api/logs/events/since/:cursor`
- `POST /api/ai/analyze-media`

### 6.2 Rascunhos

Arquivo: `frontend/src/pages/drafts-page.jsx`

**Para que serve:** armazenar trabalhos em andamento sem publicar.

**Funções:**

- Listar rascunhos.
- Buscar por texto ou título.
- Filtrar por plataforma e tipo.
- Visualizar mídia associada.
- Reabrir o conteúdo no Criador de Posts.
- Excluir rascunhos.
- Criar um rascunho rápido a partir de texto.

**APIs:** `GET/POST/DELETE /api/drafts...`.

### 6.3 Calendário

Arquivo: `frontend/src/pages/calendar-page.jsx`

**Para que serve:** visualizar o planejamento editorial e ajustar horários.

**Funções:**

- Navegar por mês.
- Voltar para hoje.
- Ir para mês anterior/próximo.
- Alternar entre calendário e lista.
- Filtrar por rede.
- Abrir o detalhe das publicações de um dia.
- Ver mídia, texto, plataformas e status.
- Editar o horário de uma publicação agendada.
- Arrastar uma publicação para outro dia.
- Exibir mensagens amigáveis de erro de publicação.

**APIs:**

- `GET /api/posts/calendar?year=...&month=...`
- `PATCH /api/posts/:id` com `scheduledAt`.

As preferências de visualização ficam salvas no `localStorage` do dispositivo.

### 6.4 Filas recorrentes

Arquivo: `frontend/src/pages/content-queues-page.jsx`

**Para que serve:** automatizar conteúdos que se repetem em dias e horários definidos.

**Funções:**

- Criar uma fila com nome.
- Definir texto e redes.
- Selecionar dias da semana.
- Definir horário.
- Ativar ou pausar uma fila.
- Excluir uma fila.
- Visualizar próxima execução e situação atual.

**APIs:**

- `GET /api/content-queues`
- `POST /api/content-queues`
- `PATCH /api/content-queues/:id`
- `DELETE /api/content-queues/:id`

### 6.5 Biblioteca de mídia

Arquivo: `frontend/src/pages/media-library-page.jsx`

**Para que serve:** centralizar arquivos reutilizáveis e reduzir retrabalho na criação.

**Funções:**

- Listar imagens e vídeos do usuário.
- Buscar por nome.
- Filtrar por pasta.
- Criar pastas.
- Fazer upload com URL assinada.
- Associar a mídia a uma pasta.
- Excluir mídia.
- Selecionar mídia e devolvê-la ao Criador de Posts.
- Gerar sugestões de conteúdo a partir de nicho, período, redes e analytics.
- Transformar uma sugestão da IA em rascunho.

**APIs:**

- `GET/POST /api/media-assets`
- `DELETE /api/media-assets/:id`
- `GET/POST /api/media-folders`
- `POST /api/posts/upload-url`
- `GET /api/ai/analytics-insights?days=...`
- `POST /api/ai/generate`
- `POST /api/drafts`

## 7. Contas, acesso e segurança

### 7.1 Contas conectadas

Arquivo: `frontend/src/pages/accounts-page.jsx`

**Para que serve:** gerenciar as contas sociais autorizadas a publicar e fornecer métricas.

**Funções:**

- Exibir Instagram, Facebook, YouTube e TikTok.
- Mostrar descrição e capacidade de cada provedor.
- Conectar a primeira conta.
- Adicionar outra conta da mesma rede.
- Reconectar uma conta com token inválido ou expirado.
- Pesquisar contas.
- Filtrar por status do token.
- Ver saúde operacional da API de cada rede.
- Abrir o perfil público da conta quando houver URL.
- Desconectar uma conta.
- Direcionar para Tokens quando o problema for credencial.

**APIs:**

- `GET /api/accounts`
- `GET /api/platform-health`
- `GET /auth/:provider?...` para iniciar OAuth.
- `DELETE /api/accounts/:id`

### 7.2 Tokens

Arquivo: `frontend/src/pages/tokens-page.jsx`

**Para que serve:** dar visibilidade e controle sobre credenciais de integração sem exibir o segredo completo.

**Funções:**

- Listar tokens por conta e rede.
- Buscar por conta ou plataforma.
- Filtrar por rede.
- Filtrar por status: válido, expirando, expirado ou com erro.
- Renovar um token.
- Renovar todos os tokens.
- Revogar um token.
- Mostrar última utilização e vencimento.

**APIs:**

- `GET /api/tokens`
- `POST /api/tokens/renew/:id`
- `POST /api/tokens/renew-all`
- `DELETE /api/tokens/:id`

### 7.3 Segurança

Arquivo: `frontend/src/pages/security-page.jsx`

**Para que serve:** proteger o acesso com autenticação em dois fatores.

**Funções:**

- Mostrar se o 2FA está ativo.
- Gerar QR Code e chave manual.
- Confirmar o primeiro código do autenticador.
- Ativar o 2FA.
- Desativar o 2FA com um código atual.
- Explicar o uso de Google Authenticator, Authy ou equivalente.

**APIs:**

- `POST /api/me/2fa/setup`
- `POST /api/me/2fa/enable`
- `POST /api/me/2fa/disable`

### 7.4 Perfil

Arquivo: `frontend/src/pages/profile-page.jsx`

**Para que serve:** administrar identidade, preferências e sessão do usuário.

**Funções:**

- Alterar nome.
- Escolher fuso horário, idioma e plataforma padrão.
- Configurar notificações de e-mail, publicação, falha e comentários.
- Fazer upload ou remover avatar.
- Alterar senha.
- Consultar o limite diário de IA do plano gratuito.
- Ir rapidamente para contas, tokens e atividades.
- Encerrar a sessão atual.
- Encerrar todas as sessões.

**APIs:**

- `GET/PATCH /api/me/profile`
- `POST /api/me/password`
- `POST /api/me/avatar`
- `POST /api/me/logout-all`
- `GET /api/ai/demo-status`
- `POST /api/posts/upload-url`

## 8. Monitoramento e relacionamento

### 8.1 Analytics

Arquivos: `frontend/src/pages/analytics-page.jsx`, `frontend/src/hooks/use-analytics.js` e `frontend/src/components/analytics/*`.

**Para que serve:** transformar métricas reais das redes em leitura de desempenho.

**Funções:**

- Selecionar a rede analisada.
- Alternar abas de comunidade, conteúdo e audiência.
- Escolher período de 7, 30 ou 90 dias.
- Comparar períodos quando disponível.
- Exibir resumo executivo.
- Exibir métricas por conta.
- Exibir visualizações, curtidas, comentários, compartilhamentos e salvamentos.
- Exibir crescimento de seguidores/inscritos.
- Exibir evolução diária.
- Exibir melhores horários.
- Exibir decadência de conteúdo.
- Exibir demografia agregada quando a API oficial fornece.
- Exibir vídeos do TikTok.
- Abrir relatório detalhado de uma conta.
- Exportar CSV.
- Gerar versão imprimível/PDF pelo navegador.
- Configurar relatórios agendados por e-mail.
- Atualizar automaticamente a cada 30 segundos enquanto a aba está visível.

**APIs e fontes:**

- `GET /api/posts/analytics?days=...`
- `GET /api/accounts`
- `GET /api/posts/tiktok-videos`
- APIs oficiais das plataformas e/ou Zernio no backend.
- `GET/POST/PATCH/DELETE /api/report-schedules...` no painel de relatórios agendados.

O módulo não deve inventar métricas. Sem conexão ou sem dados reais, mostra estado vazio e limitações da fonte.

### 8.2 Inbox

Arquivo: `frontend/src/pages/inbox-page.jsx`.

**Para que serve:** concentrar comentários e interações que precisam de resposta.

**Funções:**

- Listar posts com comentários.
- Filtrar por plataforma.
- Filtrar por situação de leitura.
- Pesquisar conteúdo ou comentário.
- Selecionar uma ou várias publicações.
- Abrir a conversa de uma publicação.
- Marcar comentários como vistos.
- Marcar várias publicações como vistas.
- Responder comentários quando a plataforma permitir.
- Visualizar mídia relacionada ao post.
- Persistir filtros no dispositivo.

**APIs:**

- `GET /api/posts/inbox`
- `GET /api/posts/inbox/unread`
- `POST /api/posts/inbox/seen`
- Endpoints de comentários do módulo de posts.

### 8.3 Central de atividades

Arquivo: `frontend/src/pages/activity-page.jsx`.

**Para que serve:** fornecer uma trilha operacional auditável.

**Funções:**

- Listar até 200 eventos recentes.
- Filtrar por tipo: sucesso, erro e informação.
- Pesquisar mensagens.
- Atualizar o histórico.
- Limpar todo o histórico após confirmação.
- Identificar plataforma e horário do evento.

**APIs:**

- `GET /api/logs?limit=200`
- `DELETE /api/logs`

## 9. Assistente e conversão

### 9.1 Assistente IA

Arquivo: `frontend/src/pages/ai-page.jsx`.

**Para que serve:** apoiar planejamento, produção e publicação de conteúdo.

**Funções:**

- Receber uma instrução de conteúdo.
- Gerar até três ideias/postagens.
- Gerar mais ideias sem apagar as anteriores.
- Escolher o modelo de IA.
- Editar o texto gerado.
- Gerar imagem para uma ideia.
- Publicar uma ideia com imagem gerada.
- Escolher plataforma e conta compatível.
- Bloquear YouTube quando a mídia não for vídeo.
- Agendar/publicar pelo fluxo assistido.
- Consultar atividade do agente.
- Consultar analytics e diagnósticos de desempenho.
- Mostrar comparações, amostra e nível de confiança quando houver dados.

**APIs:**

- `GET /api/ai/activity-log?limit=20`
- `GET /api/accounts?ativo=true`
- `POST /api/ai/generate`
- `POST /api/ai/image/generate`
- `POST /api/posts/upload-url`
- `POST /api/ai/schedule`
- `GET /api/ai/analytics-insights?days=...`

O limite gratuito de IA é controlado pelo backend. Os textos gerados são sugestões e devem poder ser revisados antes da publicação.

### 9.2 Smartlinks

Arquivo: `frontend/src/pages/smartlinks-page.jsx`.

**Para que serve:** criar uma página pública com vários destinos, substituindo a necessidade de trocar o link da bio a cada campanha.

**Funções:**

- Criar nome interno.
- Definir título e descrição públicos.
- Cadastrar links no formato `texto | URL`.
- Listar páginas criadas.
- Mostrar quantidade de links e cliques.
- Abrir a página pública.
- Excluir um Smartlink.

**APIs:**

- `GET /api/smartlinks`
- `POST /api/smartlinks`
- `DELETE /api/smartlinks/:id`
- Página pública em `/go/:slug`.

## 10. Equipe e administração

### 10.1 Espaços de trabalho

Arquivo: `frontend/src/pages/workspace-page.jsx`.

**Para que serve:** separar operações de clientes/marcas e controlar colaboração.

**Funções:**

- Criar espaços de trabalho.
- Selecionar um espaço.
- Ver papel do usuário no espaço.
- Adicionar colaboradores existentes por e-mail.
- Definir papel de editor, aprovador ou administrador.
- Listar membros.
- Selecionar uma publicação para revisão.
- Enviar uma publicação para aprovação.
- Aprovar ou rejeitar solicitações pendentes.
- Ver histórico de aprovações.
- Definir nome exibido e cor da marca.
- Mostrar estado vazio quando ainda não existe espaço.

**APIs:**

- `GET/POST /api/workspaces`
- `GET/POST /api/workspaces/:id/members`
- `GET/POST /api/workspaces/:id/approvals`
- `PATCH /api/workspaces/approvals/:id`
- `PATCH /api/workspaces/:id/branding`
- `GET /api/posts`

### 10.2 Administração

Arquivo: `frontend/src/pages/admin-page.jsx`.

**Para que serve:** permitir que administradores gerenciem usuários da plataforma.

**Funções:**

- Identificar o administrador atual.
- Listar usuários.
- Mostrar e-mail, nome, papel, situação e quantidade de contas.
- Promover usuário a administrador.
- Rebaixar administrador para usuário, respeitando as restrições de segurança.
- Ativar usuário.
- Desativar usuário.
- Impedir que o administrador desative a si próprio.
- Preservar o isolamento entre administradores e usuários.

**APIs:**

- `GET /api/me`
- `GET /api/admin/users`
- `POST /api/admin/users/:id/role`
- `POST /api/admin/users/:id/ativo`

Essa tela fica fora do `AppShell` e é acessada por `/admin.html`.

## 11. Regras funcionais transversais

### Dados reais e isolamento

- Posts, contas, tokens, logs, comentários e analytics são filtrados pelo usuário autenticado no backend.
- O frontend deve renderizar estado vazio quando a API retornar listas vazias.
- Métricas só devem ser exibidas quando vierem de uma fonte real ou de histórico real salvo pelo produto.
- Falhas de uma rede não devem impedir que os dados das outras redes apareçam.

### Estados de carregamento e erro

Todas as páginas que consultam APIs possuem, conforme o módulo:

- Estado de carregamento.
- Mensagem de erro ou toast.
- Estado vazio específico para ausência de dados.
- Atualização após criar, editar, excluir ou alterar um recurso.

### Persistência local

O `localStorage` é utilizado para preferências de experiência, não para criar dados de negócio. Exemplos:

- Tema.
- Sidebar recolhida.
- Filtros de dashboard, calendário, inbox e analytics.
- Autosave do Criador de Posts.
- Seleção de mídia.
- Dispensa do checklist de onboarding.

### Plataformas suportadas

O produto trabalha com Instagram, Facebook, YouTube e TikTok. Cada rede pode ter regras diferentes de mídia, texto, publicação, comentários e métricas; por isso o Criador de Posts, Analytics e Contas exibem configurações e capacidades específicas.

## 12. Relação entre páginas

| Origem | Destino | Motivo |
|---|---|---|
| Dashboard | Contas | Conectar ou corrigir uma rede. |
| Dashboard | Criador de Posts | Criar a primeira publicação ou revisar falha. |
| Dashboard | Calendário | Ver próximos agendamentos. |
| Dashboard | Analytics | Ver análise completa. |
| Dashboard | Atividades | Abrir detalhes de uma publicação. |
| Contas | Tokens | Corrigir token expirado ou inválido. |
| IA | Criador de Posts | Continuar uma ideia com edição avançada. |
| IA | Analytics | Consultar desempenho usado nos insights. |
| Biblioteca | Criador de Posts | Reutilizar uma mídia selecionada. |
| Biblioteca | Rascunhos | Salvar uma sugestão gerada. |
| Equipe | Criador de Posts | Criar conteúdo para enviar à aprovação. |
| Perfil | Contas/Tokens/Atividades | Atalhos de administração pessoal. |
| Segurança | Login | O 2FA altera o fluxo de autenticação seguinte. |

## 13. Referências de implementação

- Entrada e roteamento: `frontend/src/main.jsx`.
- Módulos lazy: `frontend/src/pages/module-page.jsx`.
- Shell autenticado: `frontend/src/components/layout/app-shell.jsx`.
- Cliente HTTP: `frontend/src/lib/api.js`.
- Hooks de analytics: `frontend/src/hooks/use-analytics.js`.
- Testes de componentes: `frontend/test/components/`.
- Rotas backend correspondentes: `src/routes/`, `src/http/routes/` e `src/http/controllers/`.
