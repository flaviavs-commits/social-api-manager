const { Router } = require('express')
const scheduler = require('../services/scheduler')

const router = Router()

// Endpoints chamados pelo Vercel Cron (vercel.json) para disparar o que antes
// era feito por node-cron dentro do próprio processo — em serverless não há
// processo de fundo, então quem dispara essas tarefas é a infraestrutura de
// cron da Vercel fazendo uma requisição HTTP comum, não mais um timer interno.
function requireCronSecret(req, res, next) {
  const auth = req.headers.authorization
  // TEMPORÁRIO: aceita o secret via ?secret=... só para permitir testar o
  // endpoint direto no navegador durante a validação da migração — remover
  // depois de confirmado que o Vercel Cron real (header Authorization) funciona.
  const viaQuery = req.query.secret
  const autorizado = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) ||
    (process.env.CRON_SECRET && viaQuery === process.env.CRON_SECRET)
  if (!autorizado) {
    return res.status(401).json({ erro: 'Não autorizado' })
  }
  next()
}

router.use(requireCronSecret)

router.get('/process-posts', async (req, res) => {
  await scheduler.processarPendentes()
  res.json({ ok: true })
})

router.get('/renew-tokens', async (req, res) => {
  await scheduler.renovarTokensProativamente()
  res.json({ ok: true })
})

module.exports = router
