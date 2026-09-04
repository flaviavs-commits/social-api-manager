const postsRepo = require('../../infra/db/postsRepository')
const { normalizarScheduledAtBR, scheduledAtParaUTC } = require('../../domain/posts/post')
const { ValidationError } = require('../../domain/posts/errors')

async function reagendarPost({ id, scheduledAt, userId, isAdmin }) {
  const scheduledAtBR = normalizarScheduledAtBR(scheduledAt)
  if (!scheduledAtBR || Number.isNaN(new Date(scheduledAtBR).getTime())) {
    throw new ValidationError('scheduledAt inválido')
  }
  return postsRepo.reagendarPost({ id, scheduledAt: scheduledAtParaUTC(scheduledAtBR), userId, isAdmin })
}

module.exports = { reagendarPost }
