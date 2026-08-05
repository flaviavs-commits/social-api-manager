const { Router } = require('express')
const controller = require('../controllers/postsController')

const router = Router()

router.post('/upload-url', controller.postUploadUrl)

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
router.delete('/:id', controller.deletePost)

module.exports = router
