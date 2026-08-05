const { Router } = require('express')
const controller = require('../http/controllers/accountsController')

// Contas e conexões de redes sociais são sempre restritas ao dono, mesmo para
// admin/super_admin — cada pessoa só vê e gerencia as próprias redes sociais
// no uso normal do painel. Ver [[project_isolamento_contas_admin]].

const router = Router()
router.get('/stats', controller.getStats)
router.get('/', controller.list)
router.get('/:id', controller.getById)
router.post('/', controller.create)
router.delete('/:id', controller.remove)

module.exports = router
