# Checkout e cobrança (Stripe)

Como um pagamento vira um plano ativo na conta do cliente, e o que fazer quando
não vira.

## Assinatura de verdade (migração concluída em 10-11/09/2026)

Decisão registrada no `IA.md`: os planos viraram assinatura recorrente de
verdade (`mode=subscription`), em vez da cobrança avulsa que existia antes. O
trabalho foi quebrado em 5 tasks sequenciais, todas concluídas:

- O checkout (`createCheckout`) já cria a sessão em `mode: 'subscription'`,
  com os dois itens (plano + MeuEcoo) recorrentes mensais, e reaproveita/
  persiste o Stripe Customer do usuário (`users.stripe_customer_id`).
- O **primeiro pagamento** de cada assinatura continua sendo confirmado pelo
  caminho já existente (`checkout.session.completed` → `confirmarPagamento`),
  porque o valor cobrado na primeira fatura bate com o valor registrado.
- O webhook já trata o **ciclo de vida da assinatura**:
  `customer.subscription.created/updated/deleted` sincronizam a tabela
  `subscriptions` e `users.plan_active`; `invoice.paid` confirma renovação
  (concede acesso); `invoice.payment_failed` registra log e avisa o cliente
  por e-mail a cada falha (não revoga acesso — `past_due` é aviso, a Stripe
  tenta cobrar de novo sozinha). Ver
  `billingService.handleSubscriptionCreated/Updated/Deleted`,
  `handleInvoicePaid/PaymentFailed`, `mailer.enviarEmailFalhaCobrancaAssinatura`.
- **Cancelamento self-service via Customer Portal**: `POST /api/billing/portal`
  cria uma sessão hospedada pela própria Stripe (`stripeGateway.createPortalSession`,
  confirmado contra `docs.stripe.com/api/customer_portal/sessions/create`) —
  o cliente cancela, troca cartão e vê faturas sem nenhuma tela própria do
  app. Exige `users.stripe_customer_id` já preenchido (alguém que nunca
  assinou recebe `400 no_stripe_customer`). `GET /api/billing/status` expõe
  `subscription.manageable` para o frontend decidir se mostra o botão
  "Gerenciar assinatura" no perfil.
- **Trocar de plano com uma assinatura já ativa não cria mais um checkout
  novo** (`billingService.updateActiveSubscriptionPlan`): atualiza os itens
  da assinatura existente na Stripe via `POST /subscriptions/:id`, que calcula
  o proration sozinha. Antes disso, toda troca — mesmo já tendo assinatura —
  abria uma segunda assinatura em paralelo, sem cancelar a primeira (risco
  real de cobrar as duas ao mesmo tempo). O checkout dinâmico
  (`createCheckout`) continua existindo só para a primeira assinatura do
  usuário. Essa troca não passa por `billing_plan_changes` — não há
  necessidade de relaxar `UNIQUE(user_id, billing_month)`, porque essa tabela
  segue reservada à primeira assinatura de cada usuário (seu propósito
  original: evitar duas primeiras cobranças no mesmo mês).
- Idempotência dos eventos de assinatura no webhook é a natural das
  operações (UPDATE/INSERT com `ON CONFLICT`, nenhuma linha nova por
  renovação) — decisão de 10/09/2026, sem tabela de deduplicação por
  `event.id`.

Ordem das 5 tasks: schema de assinatura → checkout em modo assinatura →
webhook de ciclo de vida → idempotência de renovação/histórico de troca de
plano → Customer Portal.

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
`(user_id, billing_month)`. Essa trava foi desenhada para o modelo avulso;
com assinatura recorrente a renovação automática não é "uma nova troca de
plano" — revisão prevista na task "idempotência de renovação".

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

## Reembolso e disputa (charge.refunded / charge.dispute.created)

Decisão registrada no `IA.md` de 11/09/2026 (Trilha B, task "decidir o que
fazer em reembolso e disputa"):

| Evento | Ação |
| --- | --- |
| Reembolso **total** (`charge.refunded`, `refunded: true`) | Revoga o acesso na hora — o dinheiro já voltou. |
| Reembolso **parcial** (`amount_refunded > 0`, `refunded: false`) | **Não** revoga sozinho — pode ser cortesia pontual. Só alerta um admin. |
| Disputa/chargeback (`charge.dispute.created`) | **Nunca** revoga sozinho — pode ser engano do cliente, e leva dias para resolver. Só alerta. |

`Dispute` não carrega `customer` diretamente (só `charge`/`payment_intent`) —
o handler de disputa não tenta resolver a conta, para não gastar uma chamada
extra à Stripe numa decisão que é sempre "alertar, nunca agir sozinho"; o
admin já pode abrir o `charge` no dashboard. O alerta reaproveita
`mailer.enviarEmailAlertaEventoStripe`, genérico (não é o mesmo e-mail de
"pagamento sem conta vinculada" — aqui a conta já é conhecida).

⚠️ **Não testado contra `stripe trigger` real** — os handlers foram validados
com payloads sintéticos fiéis ao formato documentado da Stripe (testes
unitários com mutação), mas nunca com um evento real disparado pela CLI.
Mesma limitação já registrada para os eventos de assinatura.

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

## ⚠️ Antes de remover uma conta, cancele a assinatura na Stripe

Hoje **não existe nenhum endpoint no app para excluir uma conta** — a única
forma de remover um usuário é acesso direto ao Postgres de produção.

Se a conta tiver uma assinatura ativa e você só apagar a linha em `users`
(mesmo com `ON DELETE CASCADE` limpando `subscriptions` e o resto), **a
assinatura continua ativa e cobrando na Stripe**. O cliente não existe mais
no app, mas o cartão dele continua sendo debitado todo mês, sem nada no lado
da aplicação avisando isso — risco financeiro e de reputação real, não
teórico (foi descoberto ao remover uma conta de teste em 11/09/2026; por
sorte aquela conta nunca teve assinatura).

**Antes de qualquer `DELETE FROM users` de uma conta que pode ter pago:**

```sql
SELECT stripe_customer_id FROM users WHERE id = <id>;
SELECT stripe_subscription_id, status FROM subscriptions WHERE user_id = <id> ORDER BY created_at DESC LIMIT 1;
```

Se houver `stripe_subscription_id` com status diferente de `canceled`,
cancele **antes** de apagar — via dashboard da Stripe (Customers → assinatura
→ Cancel subscription) ou chamando `billingService.cancelSubscriptionForUser(userId)`
num script/REPL contra o app (função pronta desde 11/09/2026, ainda sem
endpoint HTTP que a exponha — nenhuma decisão foi tomada ainda sobre quem
pode excluir uma conta e por qual caminho; ver task "quem gera o link de
pagamento" para o mesmo tipo de decisão já resolvida em outro contexto).

Quando um endpoint de exclusão/desativação de conta for criado, ele deve
chamar essa função antes de remover o usuário — não repetir a lógica de
cancelamento na mão.

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
