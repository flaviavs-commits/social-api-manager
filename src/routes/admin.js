const { Router } = require('express')
const controller = require('../http/controllers/adminController')

const router = Router()

router.get('/users', controller.listUsers)
router.get('/users/search', controller.searchUserByEmail)
router.post('/users/:id/role', controller.updateRole)
router.post('/users/:id/ativo', controller.updateActive)
router.get('/users/:id/plan-link/:plan', controller.getPlanLink)
router.get('/billing/reconciliation', controller.getReconciliationReport)
router.post('/billing/reconciliation/:sessionId/link', controller.linkPayment)

module.exports = router
