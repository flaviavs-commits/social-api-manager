const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const controller = require('../controllers/postsController')

const router = Router()
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Limite de uploads atingido. Aguarde antes de enviar mais arquivos.' }
})

router.post('/upload-url', uploadLimiter, controller.postUploadUrl)

router.get('/inbox/unread', controller.getInboxUnread)
router.post('/inbox/seen', controller.postInboxSeen)
router.post('/:id/comments/seen', controller.postCommentSeen)
router.get('/inbox', controller.getInbox)

router.get('/calendar', controller.getCalendar)
router.get('/', controller.getPosts)
router.get('/analytics', controller.getAnalytics)
router.get('/tiktok-videos', controller.getTiktokVideos)
router.get('/tiktok-creator-info', controller.getTiktokCreatorInfo)
router.get('/facebook-places', controller.getFacebookPlaces)
router.get('/:id/metrics-history', controller.getMetricsHistory)

router.post('/', controller.postCreate)

router.get('/:id/comments', controller.getComments)
router.post('/:id/comments/:commentId/reply', controller.postCommentReply)

router.patch('/:id', controller.patchPost)
// Publicações não são excluídas pela aplicação. A remoção deve ser feita
// diretamente na rede social para preservar o histórico e as métricas.
router.delete('/:id', (_req, res) => res.status(405).json({ erro: 'A aplicação não exclui publicações. Remova o post diretamente na rede social.' }))

module.exports = router
