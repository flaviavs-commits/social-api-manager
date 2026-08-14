const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
})

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

async function enviarRelatorioAgendado(recipients, name, periodDays, summary, { pdf, filename } = {}) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('E-mail não configurado para relatórios agendados')
  await transporter.sendMail({
    from: `"Meu Ecoo Mídia" <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject: `${name} — relatório dos últimos ${periodDays} dias`,
    html: `<div style="font-family:sans-serif;max-width:620px;margin:0 auto"><h2>${name}</h2><p>Resumo operacional dos últimos ${periodDays} dias:</p><ul>${summary}</ul><p style="color:#777">O relatório completo está anexado em PDF.</p></div>`,
    ...(pdf ? { attachments: [{ filename: filename || 'relatorio-operacional.pdf', content: pdf, contentType: 'application/pdf' }] } : {})
  })
}

module.exports = { enviarEmailRedefinicaoSenha, enviarRelatorioAgendado }
