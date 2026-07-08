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
    from: `"Social Api Manager" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Redefinição de senha — Social Api Manager',
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

module.exports = { enviarEmailRedefinicaoSenha }
