const { Router } = require('express')
const { receber, processarZernioWebhook } = require('../services/zernioWebhookService')

const router = Router()

// O corpo chega como Buffer porque a assinatura da Zernio é calculada sobre
// os bytes originais, antes de qualquer JSON.parse.
router.post('/', async (req, res, next) => {
  try {
    const result = await receber({ rawBody: req.body, headers: req.headers })
    if (result.status !== 200) return res.status(result.status).json(result.body)

    // O evento já foi persistido antes do 200. O processamento não fica no
    // caminho crítico da entrega e também pode ser retomado pelo cron se a
    // instância reiniciar logo após o ACK.
    if (result.eventRowId) {
      setImmediate(() => {
        processarZernioWebhook(result.eventRowId).catch(error => {
          console.error('[zernio-webhook] processamento assíncrono falhou:', error.message)
        })
      })
    }
    return res.status(200).json(result.body)
  } catch (error) {
    return next(error)
  }
})

module.exports = router
