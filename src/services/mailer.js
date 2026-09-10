const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
})

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function ensureEmailConfigured() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('E-mail não configurado para liberação do MeuEcoo')
  }
}

async function enviarEmailRedefinicaoSenha(email, resetLink) {
  await transporter.sendMail({
    from: `"Meu Ecoo Mídia" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Redefinição de senha — Meu Ecoo Mídia',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">Redefinir sua senha</h2>
        <p>Recebemos um pedido para redefinir a senha da sua conta.</p>
        <p>
          <a href="${resetLink}" style="display: inline-block; background: #6c8cff; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Criar nova senha
          </a>
        </p>
        <p style="color: #888; font-size: 13px;">Este link é válido por 1 hora. Se você não pediu essa redefinição, pode ignorar este e-mail.</p>
      </div>
    `
  })
}

async function enviarEmailAcessoMeuEcoo(email, { fullName, planName, offer, accessUrl }) {
  ensureEmailConfigured()
  const safeName = escapeHtml(fullName || 'Olá')
  const safePlanName = escapeHtml(planName || 'seu plano')
  const safeOffer = escapeHtml(offer || 'Seu plano inclui acesso ao MeuEcoo.')
  const safeAccessUrl = escapeHtml(accessUrl)

  await transporter.sendMail({
    from: `"Meu Ecoo Mídia" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Seu acesso ao MeuEcoo está liberado',
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #222;">
        <h2 style="color: #333;">${safeName}, seu acesso está liberado</h2>
        <p>O pagamento do plano <strong>${safePlanName}</strong> foi confirmado.</p>
        <p>${safeOffer}</p>
        <p style="margin: 28px 0;">
          <a href="${safeAccessUrl}" style="display: inline-block; background: #6c8cff; color: #fff; padding: 13px 22px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Acessar o MeuEcoo
          </a>
        </p>
        <p style="color: #777; font-size: 13px;">Use o mesmo e-mail e senha da sua conta Meu Ecoo Mídia para entrar.</p>
        <p style="color: #999; font-size: 12px;">Se o botão não abrir, copie este endereço: <a href="${safeAccessUrl}">${safeAccessUrl}</a></p>
      </div>
    `,
    text: `${fullName || 'Olá'}, seu acesso ao MeuEcoo está liberado. O pagamento do plano ${planName || 'seu plano'} foi confirmado. Acesse: ${accessUrl}`
  })
}

async function enviarRelatorioAgendado(recipients, name, periodDays, summary, { pdf, filename } = {}) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('E-mail não configurado para relatórios agendados')
  const safeName = escapeHtml(name || 'Relatório operacional')
  const subjectName = String(name || 'Relatório operacional').replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  await transporter.sendMail({
    from: `"Meu Ecoo Mídia" <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject: `${subjectName} — relatório dos últimos ${periodDays} dias`,
    html: `<div style="font-family:sans-serif;max-width:620px;margin:0 auto"><h2>${safeName}</h2><p>Resumo operacional dos últimos ${periodDays} dias:</p><ul>${summary}</ul><p style="color:#777">O relatório completo está anexado em PDF.</p></div>`,
    ...(pdf ? { attachments: [{ filename: filename || 'relatorio-operacional.pdf', content: pdf, contentType: 'application/pdf' }] } : {})
  })
}

async function enviarEmailAlertaPagamentoNaoVinculado(recipients, { reason, sessionId, amountCents, currency, clientReferenceId, customerEmail, adminUrl }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('E-mail não configurado para o alerta de cobrança')
  const safeReason = escapeHtml(reason || 'motivo não informado')
  const safeSessionId = escapeHtml(sessionId || 'desconhecida')
  const valor = Number.isFinite(Number(amountCents)) ? `${(Number(amountCents) / 100).toFixed(2)} ${String(currency || '').toUpperCase()}` : 'valor desconhecido'
  const safeClientRef = escapeHtml(clientReferenceId || 'ausente')
  const safeCustomerEmail = escapeHtml(customerEmail || 'ausente')
  const safeAdminUrl = escapeHtml(adminUrl)

  await transporter.sendMail({
    from: `"Meu Ecoo Mídia" <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject: '⚠️ Pagamento confirmado sem conta vinculada',
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #222;">
        <h2 style="color: #c0392b;">Um pagamento entrou sem creditar nenhum cliente</h2>
        <p>A Stripe confirmou um pagamento, mas o sistema não conseguiu associá-lo a nenhuma conta. O cliente pagou e ainda não recebeu o plano.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0;">
          <tr><td style="padding: 4px 8px; color: #888;">Motivo</td><td style="padding: 4px 8px;">${safeReason}</td></tr>
          <tr><td style="padding: 4px 8px; color: #888;">Sessão</td><td style="padding: 4px 8px;">${safeSessionId}</td></tr>
          <tr><td style="padding: 4px 8px; color: #888;">Valor</td><td style="padding: 4px 8px;">${valor}</td></tr>
          <tr><td style="padding: 4px 8px; color: #888;">Referência</td><td style="padding: 4px 8px;">${safeClientRef}</td></tr>
          <tr><td style="padding: 4px 8px; color: #888;">E-mail do comprador</td><td style="padding: 4px 8px;">${safeCustomerEmail}</td></tr>
        </table>
        <p style="margin: 24px 0;">
          <a href="${safeAdminUrl}" style="display: inline-block; background: #6c8cff; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Vincular no painel admin
          </a>
        </p>
        <p style="color: #999; font-size: 12px;">Se o botão não abrir, copie este endereço: <a href="${safeAdminUrl}">${safeAdminUrl}</a></p>
      </div>
    `,
    text: `Um pagamento entrou sem creditar nenhum cliente. Motivo: ${reason || 'não informado'}. Sessão: ${sessionId || 'desconhecida'}. Valor: ${valor}. Referência: ${clientReferenceId || 'ausente'}. E-mail do comprador: ${customerEmail || 'ausente'}. Vincule em: ${adminUrl}`
  })
}

// Decisão registrada no IA.md de 10/09/2026 (task "decidir alerta ao cliente
// em falha de cobrança recorrente"): e-mail simples, disparado a cada
// tentativa que falhar (não só perto do cancelamento) — sem link de
// atualização de forma de pagamento, porque isso depende do Customer Portal
// (task ainda não feita).
async function enviarEmailFalhaCobrancaAssinatura(email, { fullName, planName }) {
  ensureEmailConfigured()
  const safeName = escapeHtml(fullName || 'Olá')
  const safePlanName = escapeHtml(planName || 'sua assinatura')

  await transporter.sendMail({
    from: `"Meu Ecoo Mídia" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Não conseguimos processar a cobrança da sua assinatura',
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #222;">
        <h2 style="color: #333;">${safeName}, a cobrança deste mês falhou</h2>
        <p>Tentamos cobrar a renovação do plano <strong>${safePlanName}</strong>, mas o pagamento não foi processado — geralmente por cartão vencido, sem limite ou recusado pelo banco.</p>
        <p>Vamos tentar novamente automaticamente nos próximos dias. Se o problema persistir, o acesso à sua assinatura pode ser suspenso.</p>
        <p style="color: #777; font-size: 13px;">Se você já regularizou o pagamento, pode ignorar este e-mail.</p>
      </div>
    `,
    text: `${fullName || 'Olá'}, a cobrança da renovação do plano ${planName || 'sua assinatura'} falhou. Vamos tentar novamente automaticamente nos próximos dias. Se o problema persistir, o acesso pode ser suspenso.`,
  })
}

module.exports = { enviarEmailRedefinicaoSenha, enviarEmailAcessoMeuEcoo, enviarRelatorioAgendado, enviarEmailAlertaPagamentoNaoVinculado, enviarEmailFalhaCobrancaAssinatura }
