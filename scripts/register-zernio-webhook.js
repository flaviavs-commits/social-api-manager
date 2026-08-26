require('dotenv').config()

const zernioClient = require('../src/infra/social/zernioClient')

async function main() {
  const secret = String(process.env.ZERNIO_WEBHOOK_SECRET || '').trim()
  const baseUrl = String(process.env.BASE_URL || '').replace(/\/$/, '')
  const url = String(process.env.ZERNIO_WEBHOOK_URL || `${baseUrl}/webhooks/zernio`).trim()

  if (!secret) throw new Error('Defina ZERNIO_WEBHOOK_SECRET antes de cadastrar o webhook.')
  if (!url || !/^https:\/\//i.test(url)) throw new Error('ZERNIO_WEBHOOK_URL/BASE_URL deve ser uma URL HTTPS pública.')

  const result = await zernioClient.createWebhookSettings({
    name: 'Social API Manager - confirmações de publicação',
    url,
    secret,
    events: [
      'post.published',
      'post.partial',
      'post.failed',
      'post.platform.published',
      'post.platform.failed'
    ]
  })
  const webhook = result?.webhook || result
  console.log(`Webhook da Zernio cadastrado: ${webhook?._id || webhook?.id || 'id não retornado'}`)
  console.log(`URL: ${url}`)
}

main().catch(error => {
  console.error(`Não foi possível cadastrar o webhook da Zernio: ${error.message}`)
  process.exitCode = 1
})
