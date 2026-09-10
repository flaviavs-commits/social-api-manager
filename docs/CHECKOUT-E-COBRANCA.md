# Checkout e cobrança (Stripe)

Como um pagamento vira um plano ativo na conta do cliente, e o que fazer quando
não vira.

## Os dois caminhos de pagamento

Existem **dois** jeitos de um cliente pagar. Os dois terminam no mesmo webhook,
mas identificam a conta de formas diferentes.

### 1. Checkout dinâmico (dentro do app)

É o caminho principal: o cliente clica em "Escolher plano" no perfil.

```
profile-page → POST /api/billing/plan-change
             → billingService.requestPlanChange()
             → billing_plan_changes (linha 'pending' com a sessão do gateway)
             → stripeGateway.createCheckout()  ← cria a Checkout Session
             → redireciona para a URL da Stripe
```

A sessão é criada pelo app, então já carrega tudo que o webhook precisa:
`client_reference_id=billing:<id>` e `metadata.to_plan`. O webhook confirma o
pagamento casando `gateway_session_id` com a linha pendente.

Uma cobrança por usuário por mês — garantido pelo índice único
`(user_id, billing_month)`.

### 2. Payment Link estático (fora do app)

São os links fixos `https://buy.stripe.com/...` guardados em
`config/plans.json` (campo `checkoutUrl`), enviados manualmente ao cliente.

Esses links **não** passam pelo app, então não existe linha pendente em
`billing_plan_changes` nem `metadata.to_plan`. O webhook precisa descobrir
sozinho quem pagou e o que comprou.

## ⚠️ Ao enviar um link fixo, use o endpoint — não copie do JSON

```
GET /api/billing/plan-link/:plan                    (autenticado, como o próprio cliente)
GET /api/admin/users/:id/plan-link/:plan             (autenticado, qualquer admin — gera para outra conta)
→ { "url": "https://buy.stripe.com/...?client_reference_id=user:7&prefilled_email=..." }
```

O `client_reference_id` é o que amarra o pagamento à conta
([doc oficial](https://docs.stripe.com/payment-links/url-parameters)).
Copiar a URL crua de `config/plans.json` remove essa marcação e joga o
pagamento no caminho de fallback abaixo.

A rota `/api/admin/...` é o único ponto do painel admin em que um admin acessa
algo de outra conta — decisão registrada no `IA.md` de 10/09/2026. Cada geração
fica auditada no log do próprio admin que gerou (`adminController.getPlanLink`).
No frontend, é a coluna "Link de pagamento" em `admin-page.jsx`.

## Como o webhook identifica a conta

`POST /api/billing/stripe/webhook` (público, corpo bruto, assinatura HMAC
verificada em `stripeGateway.verifyWebhook`).

Ordem de resolução em `checkout.session.completed`:

| # | Sinal | Origem | Resultado |
|---|-------|--------|-----------|
| 1 | `metadata.to_plan` + `gateway_session_id` | checkout dinâmico | confirma a linha pendente |
| 2 | `client_reference_id` = `user:<id>` | link gerado pelo endpoint | cria a cobrança já paga e ativa o plano |
| 3 | `customer_details.email` | link cru (fallback) | idem, se o e-mail bater com uma conta ativa |
| 4 | nada bate | — | `unlinked` + log de erro para reconciliação manual |

O **plano** de um pagamento por link é identificado pelo valor pago
(`findPlanByAmount`), já que cada plano tem um `priceCents` distinto. Se o valor
não bater com nenhum plano exatamente, o sistema **não adivinha**: registra como
`unlinked`. Isso é proposital — creditar o plano errado é pior que não creditar.

O mesmo vale para o caminho 1 (checkout dinâmico): se o valor/moeda/plano
confirmados pela Stripe não baterem exatamente com o que foi registrado na
criação do checkout (Stripe Tax, cupom, preço mudou entre criar e pagar), o
webhook também vira `unlinked` em vez de 500 — a Stripe reentregaria pra
sempre com o mesmo resultado, deixando o cliente pago sem plano. Erros que
não são divergência (ex.: falha real de conexão com o banco) continuam
subindo como erro de servidor, para a Stripe reentregar de verdade.

### Quando um pagamento não é vinculado

O webhook responde `200 {"received": true, "status": "unlinked"}` (200 para a
Stripe não ficar reentregando) e grava um log de erro com tudo que é preciso
para achar o pagamento na Stripe:

```
Pagamento confirmado sem vínculo com uma conta (<motivo>).
session=cs_... payment_intent=pi_... valor=10050 BRL
client_reference_id=... email=...
```

Procure por `sem vínculo com uma conta` nos logs para achar pagamentos que
precisam de correção manual.

Motivos possíveis:
- valor pago não corresponde a nenhum plano (cupom, imposto, preço antigo);
- nenhuma conta encontrada pelo id nem pelo e-mail;
- já existe cobrança do mês para aquele usuário (o sistema não sobrescreve).

### Relatório de conciliação e vínculo manual

Além do log, um admin pode resolver isso sem acesso direto ao banco:

```
GET  /api/admin/billing/reconciliation?days=7            → lista sessões pagas sem cobrança 'paid' correspondente
POST /api/admin/billing/reconciliation/:sessionId/link    → { userId, plan } vincula manualmente
```

Diferente do log, o relatório consulta a Stripe diretamente (`payment_status:
paid` nas sessões dos últimos N dias, `created[gte]`), então também pega o
caso raro de o webhook nunca ter chegado. `days` é limitado a 1–30; a
resposta traz `truncated: true` se a janela tiver mais de 500 sessões pagas.

O vínculo manual reaproveita `confirmarPagamentoDireto` (mesma função do
vínculo automático) — reenviar a mesma sessão não duplica a cobrança. Toda
geração de link e todo vínculo manual gravam log de auditoria no histórico do
**admin que agiu**, nunca no da conta-alvo.

No frontend, é a seção "Pagamentos não conciliados" em `admin-page.jsx`, logo
abaixo da lista de usuários.

⚠️ Não há alerta ativo (e-mail/push) quando um pagamento fica sem vínculo —
decisão deliberada de 10/09/2026, registrada no `IA.md`: em vez de escolher um
destinatário agora, ficou para uma task futura de painel de admin. Hoje, a
visibilidade depende de alguém abrir esta seção.

## Idempotência

Reentrega do mesmo evento é segura em todos os caminhos:
- `gateway_session_id` é único; `confirmarPagamentoDireto` procura a linha antes
  de inserir e devolve a existente;
- `confirmarPagamento` não reprocessa linha já `paid`;
- o e-mail do MeuEcoo tem reserva atômica (`reservarEnvioMeuEcoo`).

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `STRIPE_SECRET_KEY` | criar Checkout Sessions |
| `STRIPE_WEBHOOK_SECRET` | verificar a assinatura do webhook |
| `PAYMENT_GATEWAY` | `stripe` (padrão) |
| `FRONTEND_URL` / `BASE_URL` | montar success/cancel URL |
| `PAYMENT_SUCCESS_URL` / `PAYMENT_CANCEL_URL` | sobrescrever os retornos |
| `MEU_ECOO_ACCESS_URL` | link enviado no e-mail do benefício |

Sem `STRIPE_SECRET_KEY` **e** `STRIPE_WEBHOOK_SECRET` o gateway se declara não
configurado e a troca de plano responde 503. **Foi exatamente esse o motivo de
nenhum checkout ter sido criado em produção até 09/09/2026**: as duas variáveis
simplesmente não existiam no Railway.

## Configuração de produção (Railway → serviço `social-api-manager`)

O webhook deve apontar **direto para o Railway**, não para o domínio da Vercel:
o `vercel.json` proxeia `/api/*`, e passar o corpo por um proxy arrisca quebrar
a verificação de assinatura, que exige os bytes exatos.

```
https://social-api-manager-production.up.railway.app/api/billing/stripe/webhook
```

Eventos a habilitar no endpoint (os 4):
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`.

### ⚠️ Para entrar em produção de verdade (trocar teste → live)

Hoje o Railway está com chaves de **teste** (`sk_test_`/`whsec_` de modo teste).
Com elas o site **não cobra de verdade**: cartão real é recusado, só cartão de
teste (4242…) passa. Para começar a cobrar:

1. Stripe em **modo live** → Developers → API keys → copiar a `sk_live_`.
2. Developers → Webhooks → **Add endpoint** (o endpoint de teste não vale em
   live) com a URL acima e os 4 eventos → copiar o `whsec_` do endpoint live.
3. No Railway, substituir `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` pelos
   valores live. O redeploy é automático.
4. Conferir com um pagamento real de valor baixo.

### Cadastro público

`ALLOWED_EMAIL_DOMAINS` restringe quem pode criar conta. Enquanto estiver com
`vitissouls.com`, **o cadastro público retorna 403** e nenhum cliente externo
consegue se registrar — nem com o Stripe funcionando. Esvaziar a variável libera
qualquer domínio.

## Testes

| Arquivo | Cobre |
|---|---|
| `tests/integration/billingWebhook.test.js` | webhook no nível HTTP com assinatura HMAC real: assinatura inválida/expirada, os dois caminhos de pagamento, fallback por e-mail, idempotência, casos `unlinked`, endpoint do link |
| `tests/unit/billingService.test.js` | regras de troca de plano e resolução do webhook |
| `tests/unit/repositories/billingRepository.test.js` | transação do vínculo direto: commit, rollback, idempotência, conflito de mês |
| `tests/unit/stripeGateway.test.js` | montagem do checkout e verificação de assinatura |

Para conferir contra a Stripe de verdade (opcional, exige chaves de teste):

```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/stripe/webhook
# usa o whsec_... impresso pelo listen como STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed
```
