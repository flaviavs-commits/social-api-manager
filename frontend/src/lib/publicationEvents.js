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

export function scheduledPublicationDetails(date, platforms) {
  return {
    date: formatScheduledDate(date),
    platforms: formatPlatformList(platforms),
    platformList: [...new Set(platforms.filter(Boolean).map(platform => PLATFORM_LABELS[platform] || platform))]
  }
}

export function processingPublicationMessage(platforms) {
  return `Publicação iniciada com sucesso para ${formatPlatformList(platforms)}. Estamos enviando agora e a confirmação aparecerá aqui em instantes.`
}

export function publicationResultMessage(event) {
  if (!event || event.event_name !== 'post_published') return null

  const data = event.payload || {}
  const results = (data.results || []).map(result => ({
    ...result,
    label: `${PLATFORM_LABELS[result.platform] || result.platform || 'Rede social'}${result.account ? ` · ${result.account}` : ''}`,
    detail: result.success === true
      ? 'Publicada e confirmada'
      : result.success === 'pending'
        ? 'Aguardando confirmação'
        : result.error || 'A rede não informou o motivo.'
  }))
  const published = results.filter(result => result.success === true)
  const failures = results.filter(result => result.success === false)
  const details = failures.map(result => `${result.label}: ${result.detail}`).join(' | ')

  const platforms = formatPlatformList(data.platforms || (data.results || []).map(result => result.platform))
  const resultSummary = results.length
    ? { published: published.map(result => result.label), failures: failures.map(result => ({ label: result.label, error: result.detail })) }
    : null
  if (data.status === 'published') return { type: 'success', message: `Publicação confirmada em ${platforms}. Post #${data.id}.`, resultSummary }
  if (data.status === 'partial') return { type: 'warning', message: `Publicação parcial: ${published.length} rede(s) confirmada(s) e ${failures.length} não publicada(s).`, resultSummary }
  if (data.status === 'error') return { type: 'error', message: `Nenhuma publicação foi confirmada em ${platforms}.`, resultSummary }
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
