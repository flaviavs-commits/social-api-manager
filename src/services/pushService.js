const webpush = require('web-push')

// Só inicializa VAPID se as chaves estiverem definidas — evita crash no startup
// quando as variáveis de ambiente ainda não foram configuradas no Railway.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@app.local'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

async function enviarPush(subscription, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload))
  } catch (e) {
    if (e.statusCode === 410) return 'expired'
    console.error('Push error:', e.message)
  }
}

module.exports = { enviarPush }
