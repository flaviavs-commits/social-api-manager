// O painel de Analytics dispara vários widgets em paralelo (métricas por
// conta, por período, por rede), e cada um vira uma ou mais chamadas ao
// Zernio. O plano atual (0-2 contas conectadas) tem limite de 6 req/s para
// o grupo de endpoints de analytics — estourar isso não derruba nada, mas
// cada chamada que leva 429 vira, do lado do usuário, "Métricas
// indisponíveis" ou "Tempo esgotado", mesmo com o Zernio saudável e
// respondendo em milissegundos.
//
// Em vez de só reagir a 429 com retry (o que ainda deixa a rajada inicial
// estourar o limite), este limitador enfileira as chamadas e as libera no
// máximo à taxa configurada — um token bucket simples e sem dependências.
// Fila única por processo: todas as chamadas de analytics (dashboard,
// Analytics completo, agente de IA) competem pelo mesmo limite real do
// Zernio, então precisam ser throttled juntas, não por endpoint isolado.

const DEFAULT_MAX_PER_SECOND = Number(process.env.ZERNIO_ANALYTICS_MAX_RPS || 5)

function createRateLimiter(maxPerSecond = DEFAULT_MAX_PER_SECOND) {
  const intervalMs = Math.ceil(1000 / Math.max(1, maxPerSecond))
  let nextSlot = null
  const queue = []
  let draining = false

  function scheduleNext() {
    const now = Date.now()
    nextSlot = nextSlot === null ? now : Math.max(now, nextSlot + intervalMs)
    return nextSlot - now
  }

  async function drain() {
    if (draining) return
    draining = true
    while (queue.length) {
      const wait = scheduleNext()
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
      const job = queue.shift()
      job.resolve()
    }
    draining = false
  }

  // Reserva um "assento" na fila; resolve quando for a vez da chamada
  // seguir. Não executa a chamada em si — só controla o timing.
  function acquire() {
    return new Promise(resolve => {
      queue.push({ resolve })
      drain()
    })
  }

  return { acquire }
}

// Limite conservador: fica abaixo dos 6 req/s documentados para dar folga a
// chamadas concorrentes de outras partes do app (publicação, webhooks) que
// também podem competir pela mesma cota do Zernio.
const analyticsLimiter = createRateLimiter()

module.exports = { createRateLimiter, analyticsLimiter }
