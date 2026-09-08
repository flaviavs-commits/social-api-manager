const { executarFfmpegComTimeout } = require('../../src/infra/storage/mediaConverter')

function criarComando({ finalizar = false } = {}) {
  const handlers = {}
  const command = {
    on: jest.fn((event, handler) => {
      handlers[event] = handler
      return command
    }),
    save: jest.fn(() => {
      if (finalizar) setImmediate(() => handlers.end())
      return command
    }),
    kill: jest.fn()
  }
  return command
}

describe('executarFfmpegComTimeout', () => {
  test('resolve quando o FFmpeg termina normalmente', async () => {
    const command = criarComando({ finalizar: true })

    await expect(executarFfmpegComTimeout(command, 'saida.mp4', 1)).resolves.toBeUndefined()
    expect(command.save).toHaveBeenCalledWith('saida.mp4')
    expect(command.kill).not.toHaveBeenCalled()
  })

  test('encerra o processo e rejeita quando o limite é excedido', async () => {
    const command = criarComando()

    await expect(executarFfmpegComTimeout(command, 'saida.mp4', 0.01))
      .rejects.toMatchObject({ code: 'FFMPEG_TIMEOUT' })
    expect(command.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
