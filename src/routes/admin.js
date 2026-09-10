const { Router } = require('express')
const controller = require('../http/controllers/adminController')

const router = Router()

router.get('/users', controller.listUsers)
router.post('/users/:id/role', controller.updateRole)
router.post('/users/:id/ativo', controller.updateActive)
router.get('/users/:id/plan-link/:plan', controller.getPlanLink)

module.exports = router
