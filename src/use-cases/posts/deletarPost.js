const postsRepo = require('../../infra/db/postsRepository')

async function deletarPost({ id, userId, isAdmin }) {
  return postsRepo.deletarPost(id, userId, isAdmin)
}

module.exports = { deletarPost }
