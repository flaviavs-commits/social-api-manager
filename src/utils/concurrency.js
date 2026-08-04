// Executa tarefas independentes em paralelo, com limite para não saturar APIs,
// pool do banco ou memória do processo.
async function mapWithConcurrency(items, worker, limit = 4) {
  if (!items.length) return []
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

module.exports = { mapWithConcurrency }
