const postsRepo = require('../../infra/db/postsRepository')

async function listarPosts({ status, userId, isAdmin, page, limit }) {
  return postsRepo.listarPosts({ status, userId, isAdmin, page, limit })
}

async function listarPostsCalendario({ year, month, userId, isAdmin }) {
  return postsRepo.listarPostsCalendario({ year, month, userId, isAdmin })
}

module.exports = { listarPosts, listarPostsCalendario }
