// fetch com retry para 429 (rate limit) — usado nas chamadas às Content
// Posting API do TikTok, que tem limites por app/usuário e responde 429
// quando estourados. Sem isso, um pico de posts agendados no mesmo minuto
// (o cron dispara publicações em paralelo) pode derrubar publicações que
// teriam sucesso numa segunda tentativa poucos segundos depois.
const DEFAULT_RETRIES = 3
const DEFAULT_DELAY_MS = 1000

// Respeita o header Retry-After (segundos) quando o provedor o envia;
// senão usa backoff exponencial (1s, 2s, 4s, ...).
function calcularEspera(res, tentativa, delayMs) {
  const retryAfter = Number(res.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
  return delayMs * 2 ** tentativa
}

async function fetchComRateLimit(url, options = {}, { retries = DEFAULT_RETRIES, delayMs = DEFAULT_DELAY_MS } = {}) {
  for (let tentativa = 0; ; tentativa++) {
    const res = await fetch(url, options)
    if (res.status !== 429 || tentativa >= retries) return res

    await new Promise(r => setTimeout(r, calcularEspera(res, tentativa, delayMs)))
  }
}

module.exports = { fetchComRateLimit }
