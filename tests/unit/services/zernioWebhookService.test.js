const crypto = require('crypto')

jest.mock('../../../src/repositories/zernioWebhooksRepository', () => ({
  enfileirar: jest.fn(),
  reservar: jest.fn(),
  listarPendentes: jest.fn(),
  marcarProcessado: jest.fn(),
  devolverParaFila: jest.fn()
}))

jest.mock('../../../src/infra/social/zernioClient', () => ({
  getPost: jest.fn()
}))

jest.mock('../../../src/infra/social/publisher', () => ({
  confirmarPublicacaoZernio: jest.fn()
}))

jest.mock('../../../src/infra/db/postsRepository', () => ({
  listarPostsComZernioPendentePorPostId: jest.fn()
}))

const repo = require('../../../src/repositories/zernioWebhooksRepository')
const zernioClient = require('../../../src/infra/social/zernioClient')
const postsRepo = require('../../../src/infra/db/postsRepository')
const publisher = require('../../../src/infra/social/publisher')
const service = require('../../../src/services/zernioWebhookService')

const SECRET = 'webhook-test-secret'

function signed(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload))
  const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')
  return { rawBody, headers: { 'x-zernio-signature': signature, 'x-zernio-event-id': payload.id } }
}

beforeEach(() => {
  process.env.ZERNIO_WEBHOOK_SECRET = SECRET
  jest.clearAllMocks()
})

test('valida a assinatura sobre o corpo bruto', () => {
  const rawBody = Buffer.from('{"id":"evt-1"}')
  const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')
  expect(service.verifySignature(rawBody, signature, SECRET)).toBe(true)
  expect(service.verifySignature(Buffer.from('{"id":"evt-2"}'), signature, SECRET)).toBe(false)
})

test('persiste o evento antes de confirmar o recebimento', async () => {
  repo.enfileirar.mockResolvedValue({ id: 11, eventId: 'evt-1' })
  const result = await service.receber(signed({ id: 'evt-1', event: 'post.published', post: { _id: 'zp-1' } }))

  expect(result).toEqual({ status: 200, body: { received: true, duplicate: false }, eventRowId: 11 })
  expect(repo.enfileirar).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt-1', eventName: 'post.published' }))
})

test('aceita redelivery sem criar um segundo evento', async () => {
  repo.enfileirar.mockResolvedValue(null)
  const result = await service.receber(signed({ id: 'evt-1', event: 'post.published', post: { _id: 'zp-1' } }))
  expect(result.body).toEqual({ received: true, duplicate: true })
})

test('recusa assinatura inválida sem enfileirar payload', async () => {
  const result = await service.receber({
    rawBody: Buffer.from('{"id":"evt-1","event":"post.published"}'),
    headers: { 'x-zernio-signature': '0'.repeat(64) }
  })
  expect(result.status).toBe(400)
  expect(repo.enfileirar).not.toHaveBeenCalled()
})

test('converte post.published em confirmação local com o ID da plataforma', async () => {
  postsRepo.listarPostsComZernioPendentePorPostId.mockResolvedValue([{
    id: 303,
    postAccountId: 9,
    accountId: 4,
    zernioAccountId: 'za-1',
    platform: 'instagram'
  }])
  publisher.confirmarPublicacaoZernio.mockResolvedValue({ matched: 1 })

  const result = await service.processarPayload({
    id: 'evt-1',
    event: 'post.published',
    timestamp: '2026-08-26T21:51:00.000Z',
    post: {
      _id: 'zp-1',
      platforms: [{ platform: 'instagram', status: 'published', platformPostId: 'ig-1' }]
    }
  })

  expect(result).toEqual({ matched: 1 })
  expect(publisher.confirmarPublicacaoZernio).toHaveBeenCalledWith(expect.objectContaining({
    zernioPostId: 'zp-1', platform: 'instagram', success: true, externalPostId: 'ig-1'
  }))
})

test('processa a falha por plataforma com o motivo recebido', async () => {
  postsRepo.listarPostsComZernioPendentePorPostId.mockResolvedValue([{
    id: 304,
    postAccountId: 10,
    accountId: 5,
    zernioAccountId: 'za-2',
    platform: 'tiktok'
  }])
  publisher.confirmarPublicacaoZernio.mockResolvedValue({ matched: 1 })

  await service.processarPayload({
    id: 'evt-2',
    event: 'post.platform.failed',
    platform: { platform: 'tiktok', errorMessage: 'Privacidade não permitida' },
    account: { accountId: 'za-2' },
    post: { _id: 'zp-2' }
  })

  expect(publisher.confirmarPublicacaoZernio).toHaveBeenCalledWith(expect.objectContaining({
    zernioPostId: 'zp-2', platform: 'tiktok', zernioAccountId: 'za-2', success: false, error: 'Privacidade não permitida'
  }))
})

test('marca a fila como processada após concluir o evento', async () => {
  repo.reservar.mockResolvedValue({ id: 11, eventId: 'evt-1', payload: { id: 'evt-1', event: 'webhook.test' } })
  await expect(service.processarZernioWebhook(11)).resolves.toEqual({ processed: true, matched: 0 })
  expect(repo.marcarProcessado).toHaveBeenCalledWith(11)
  expect(repo.devolverParaFila).not.toHaveBeenCalled()
})
