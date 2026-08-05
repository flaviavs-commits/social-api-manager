# Modo de revisão do TikTok — instruções e lembrete

> 🔴 **DEPOIS DE APROVADO PELO TIKTOK: VOLTAR COM O LOGIN.**
> Desligar `TIKTOK_REVIEW_MODE` na Vercel (= `false` ou deletar) + Redeploy.
> Enquanto a flag estiver ligada, qualquer pessoa entra no app sem senha.
> Detalhes na seção "Como DESATIVAR" abaixo.

O TikTok exigiu que o app abrisse direto no painel, sem tela de login, para a
revisão. Isso é atendido por um auto-login numa **conta demo isolada**,
controlado por variáveis de ambiente. Ver implementação em
[src/server.js](src/server.js) na rota `GET /`.

## Como ATIVAR (antes de submeter ao TikTok)

Na Vercel → projeto `social-api-manager` → **Settings → Environment Variables**,
adicione (ambiente Production):

| Variável                | Valor  |
|-------------------------|--------|
| `TIKTOK_REVIEW_MODE`    | `true` |
| `TIKTOK_REVIEW_USER_ID` | `38`   |

Depois, faça **Redeploy** (a Vercel pede isso ao alterar env vars).

Teste numa aba anônima: `https://social-api-manager.vercel.app/` deve cair
direto no dashboard, sem pedir login.

No formulário do TikTok, no campo de instruções para o revisor:
> "O aplicativo abre diretamente no painel principal ao acessar a URL, sem
> necessidade de login."

## ⚠️ Como DESATIVAR (OBRIGATÓRIO após a aprovação)

Enquanto `TIKTOK_REVIEW_MODE=true`, **qualquer pessoa** que abrir a URL entra
direto na conta demo, sem senha. Isso é seguro porque é uma conta isolada,
mas **deve ser desligado assim que o TikTok aprovar**:

1. Na Vercel, mude `TIKTOK_REVIEW_MODE` para `false` (ou **delete** a variável).
2. Faça **Redeploy**.
3. Confirme: a raiz `/` deve voltar a mostrar a página pública do shell React e
   o login passa a ser exigido de novo (o dashboard também entra pelo shell
   React em `/app.html`).

## Conta demo

- Usuário: `review-tiktok@demo.local` (id **38**)
- Criada apenas para esta revisão, sem dados sensíveis de produção.
- Pode receber uma conta TikTok de teste conectada se o avaliador precisar ver
  o fluxo de publicação funcionando.
