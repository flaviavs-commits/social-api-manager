const EVENT_PAGE_SIZE = 200
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }

export function formatPlatformList(platforms = []) {
  const labels = [...new Set(platforms.filter(Boolean).map(platform => PLATFORM_LABELS[platform] || platform))]
  if (!labels.length) return 'as redes selecionadas'
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`
}

export function formatScheduledDate(value) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'o horário escolhido'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(parsed)
}

export function scheduledPublicationMessage(date, platforms) {
  return `Publicação agendada com sucesso para ${formatScheduledDate(date)}. Ela será enviada para ${formatPlatformList(platforms)}.`
}

export function processingPublicationMessage(platforms) {
  return `Publicação iniciada com sucesso para ${formatPlatformList(platforms)}. Estamos enviando agora e a confirmação aparecerá aqui em instantes.`
}

export function publicationResultMessage(event) {
  if (!event || event.event_name !== 'post_published') return null

  const data = event.payload || {}
  const failures = (data.results || []).filter(result => result.success === false)
  const details = failures
    .map(result => `${result.platform}${result.account ? ` (${result.account})` : ''}: ${result.error || 'falha sem detalhes'}`)
    .join(' | ')

  const platforms = formatPlatformList(data.platforms || (data.results || []).map(result => result.platform))
  if (data.status === 'published') return { type: 'success', message: `Publicação concluída com sucesso no ${platforms}. Post #${data.id}.` }
  if (data.status === 'partial') return { type: 'warning', message: `Publicação concluída parcialmente no ${platforms}. Verifique as redes que apresentaram erro.${details ? ` ${details}` : ''}` }
  if (data.status === 'error') return { type: 'error', message: `A publicação não foi concluída no ${platforms}.${details ? ` ${details}` : ''}` }
  return null
}

// Avança até o evento mais recente antes de iniciar uma publicação. A API
// devolve no máximo 200 itens por página; drenar as páginas evita reexibir
// falhas antigas e também funciona em contas com histórico grande.
export async function latestPublicationEventId(apiFetch) {
  let cursor = 0
  while (true) {
    const { events = [] } = await apiFetch(`/api/logs/events/since/${cursor}`)
    if (!events.length) return cursor
    cursor = Math.max(cursor, ...events.map(event => Number(event.id) || 0))
    if (events.length < EVENT_PAGE_SIZE) return cursor
  }
}

export function findPublicationResult(events, postId) {
  const event = events.find(candidate => candidate.event_name === 'post_published' && Number(candidate.payload?.id) === Number(postId))
  return publicationResultMessage(event)
}
