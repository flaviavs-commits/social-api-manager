const postsRepo = require('../../infra/db/postsRepository')

async function reagendarPost({ id, scheduledAt, userId, isAdmin }) {
  return postsRepo.reagendarPost({ id, scheduledAt, userId, isAdmin })
}

module.exports = { reagendarPost }
