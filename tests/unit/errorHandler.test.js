const { ValidationError } = require('../../src/domain/posts/errors')
const { errorHandler, statusOf } = require('../../src/http/errorHandler')

function resMock() {
  return { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() }
}

describe('errorHandler', () => {
  test('converte validação em 400 sem stack trace', () => {
    const res = resMock()
    errorHandler(new ValidationError('Campo inválido'), {}, res, jest.fn())
    expect(statusOf(new ValidationError('x'))).toBe(400)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ erro: 'Campo inválido' })
  })

  test('não expõe mensagem de erro interno', () => {
    const res = resMock()
    errorHandler(new Error('senha do banco'), {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ erro: 'Erro interno do servidor' })
  })
})
