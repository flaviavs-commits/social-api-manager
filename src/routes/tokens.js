const { Router } = require('express')
const controller = require('../http/controllers/tokensController')

// Contas e conexões de redes sociais são sempre restritas ao dono, mesmo para
// admin/super_admin — cada pessoa só vê e gerencia as próprias redes sociais
// no uso normal do painel. Ver [[project_isolamento_contas_admin]].

const router = Router()
router.get('/', controller.list)
router.post('/', controller.create)
router.post('/renew-all', controller.renewAll)
router.post('/renew/:id', controller.renew)
router.delete('/:id', controller.remove)

module.exports = router
