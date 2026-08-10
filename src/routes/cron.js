const { Router } = require('express')
const scheduler = require('../services/scheduler')
const benchmarkObserver = require('../services/benchmarkObserver')
const logsRepo = require('../repositories/logsRepository')
const { safeMessage } = require('../utils/redact')

const router = Router()

// Endpoints chamados pelo Vercel Cron (vercel.json) para disparar o que antes
// era feito por node-cron dentro do próprio processo — em serverless não há
// processo de fundo, então quem dispara essas tarefas é a infraestrutura de
// cron da Vercel fazendo uma requisição HTTP comum, não mais um timer interno.
function requireCronSecret(req, res, next) {
  const auth = req.headers.authorization
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado' })
  }
  next()
}

router.use(requireCronSecret)

router.get('/process-posts', async (req, res) => {
  try {
    await scheduler.processarPendentes()
    res.json({ ok: true })
  } catch (err) {
    console.error('Falha no cron process-posts:', safeMessage(err?.stack || err?.message || err))
    res.status(500).json({ ok: false, erro: 'Falha ao processar posts pendentes.' })
  }
})

// Aproveita o mesmo agendamento de renovação de tokens para também limpar
// logs/eventos antigos — o plano da Vercel limita o número de cron jobs, e
// não há motivo para a limpeza ter um horário próprio.
router.get('/renew-tokens', async (req, res) => {
  try {
    await scheduler.renovarTokensProativamente()
    const limpeza = await logsRepo.limparAntigos()
    res.json({ ok: true, limpeza })
  } catch (err) {
    console.error('Falha no cron renew-tokens:', safeMessage(err?.stack || err?.message || err))
    res.status(500).json({ ok: false, erro: 'Falha ao renovar tokens e limpar logs.' })
  }
})

router.get('/health-check', async (req, res) => {
  try {
    await scheduler.verificarSaudePlataformas()
    res.json({ ok: true })
  } catch (err) {
    console.error('Falha no cron health-check:', safeMessage(err?.stack || err?.message || err))
    res.status(500).json({ ok: false, erro: 'Falha ao verificar plataformas.' })
  }
})

router.get('/benchmarking', async (req, res) => {
  try {
    const result = await benchmarkObserver.observarBenchmarks()
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('Falha no cron benchmarking:', safeMessage(err?.stack || err?.message || err))
    res.status(500).json({ ok: false, erro: 'Falha ao sincronizar benchmarking.' })
  }
})

module.exports = router
