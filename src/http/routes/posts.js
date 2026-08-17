const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const controller = require('../controllers/postsController')
const { requirePlanModule } = require('../../config/plans')

const router = Router()
const requireInboxPlan = requirePlanModule('inbox')
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Limite de uploads atingido. Aguarde antes de enviar mais arquivos.' }
})

router.post('/upload-url', uploadLimiter, controller.postUploadUrl)

router.get('/inbox/unread', requireInboxPlan, controller.getInboxUnread)
router.post('/inbox/seen', requireInboxPlan, controller.postInboxSeen)
router.post('/:id/comments/seen', requireInboxPlan, controller.postCommentSeen)
router.get('/inbox', requireInboxPlan, controller.getInbox)

router.get('/calendar', controller.getCalendar)
router.get('/', controller.getPosts)
router.get('/analytics', controller.getAnalytics)
router.get('/tiktok-videos', controller.getTiktokVideos)
router.get('/tiktok-creator-info', controller.getTiktokCreatorInfo)
router.get('/facebook-places', controller.getFacebookPlaces)
router.get('/:id/metrics-history', controller.getMetricsHistory)

router.post('/', controller.postCreate)
router.post('/:id/repeat', controller.postRepeat)

router.get('/:id/comments', requireInboxPlan, controller.getComments)
router.post('/:id/comments/:commentId/reply', requireInboxPlan, controller.postCommentReply)

router.patch('/:id', controller.patchPost)
// Remove o registro do calendário. Em posts já publicados, a publicação nas
// redes sociais não é apagada — apenas o registro local deixa de aparecer.
router.delete('/:id', controller.deletePost)

module.exports = router
