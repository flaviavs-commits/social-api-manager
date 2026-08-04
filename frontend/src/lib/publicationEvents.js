const EVENT_PAGE_SIZE = 200

export function publicationResultMessage(event) {
  if (!event || event.event_name !== 'post_published') return null

  const data = event.payload || {}
  const failures = (data.results || []).filter(result => result.success === false)
  const details = failures
    .map(result => `${result.platform}${result.account ? ` (${result.account})` : ''}: ${result.error || 'falha sem detalhes'}`)
    .join(' | ')

  if (data.status === 'published') return { type: 'success', message: `Post #${data.id} publicado com sucesso.` }
  if (data.status === 'partial') return { type: 'warning', message: `Post #${data.id} foi publicado parcialmente.${details ? ` ${details}` : ''}` }
  if (data.status === 'error') return { type: 'error', message: `Não foi possível publicar o post #${data.id}.${details ? ` ${details}` : ''}` }
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
