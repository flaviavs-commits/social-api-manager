const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { createRateLimitStore } = require('../../infra/http/postgresRateLimitStore')
const controller = require('../controllers/postsController')
const { requirePlanModule, requirePaidPlan } = require('../../config/plans')

const router = Router()
const requireInboxPlan = requirePlanModule('inbox')
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: req => req.user?.id ? `user:${req.user.id}` : rateLimit.ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('uploads'),
  message: { erro: 'Limite de uploads atingido. Aguarde antes de enviar mais arquivos.' }
})

router.post('/upload-url', uploadLimiter, controller.postUploadUrl)

// O upload de avatar do perfil usa a rota acima e continua disponível antes
// do pagamento. O restante desta API pertence aos módulos do produto.
router.use(requirePaidPlan)

router.get('/inbox/unread', requireInboxPlan, controller.getInboxUnread)
router.post('/inbox/seen', requireInboxPlan, controller.postInboxSeen)
router.get('/inbox/remote-comments', requireInboxPlan, controller.getRemoteComments)
router.post('/inbox/remote-comments/reply', requireInboxPlan, controller.postRemoteCommentReply)
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
