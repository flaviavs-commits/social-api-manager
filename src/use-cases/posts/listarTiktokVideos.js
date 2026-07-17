const metricsService = require('../../services/metricsService')

async function listarTiktokVideos({ userId, isAdmin }) {
  return metricsService.buscarVideosTiktok(userId, isAdmin)
}

module.exports = { listarTiktokVideos }
