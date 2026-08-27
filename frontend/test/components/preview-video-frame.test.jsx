import { describe, it, expect, vi, afterEach } from 'vitest'
import { waitForDecodedVideoFrame } from '../../src/pages/scheduler-page.jsx'

// Regressão do "borrão" no preview de vídeo do agendador: capturar o frame
// logo após um seek, usando só um tempo fixo (dois requestAnimationFrame),
// podia pegar um frame ainda não totalmente decodificado/pintado pelo
// navegador — visível como uma mancha/borrão sobre a mídia. A correção troca
// esse palpite de tempo pela confirmação real do navegador
// (requestVideoFrameCallback), com fallback para navegadores sem a API.
// Este teste trava esse contrato: sem a confirmação, a captura não deve
// prosseguir.

function fakeVideo({ readyState = 2, videoWidth = 640, videoHeight = 360 } = {}) {
  const target = new EventTarget()
  return Object.assign(target, { readyState, videoWidth, videoHeight })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForDecodedVideoFrame', () => {
  it('só resolve depois que requestVideoFrameCallback confirma o frame — não antes', async () => {
    const video = fakeVideo()
    let deliverFrame
    video.requestVideoFrameCallback = vi.fn(cb => { deliverFrame = cb })

    let resolved = false
    const promise = waitForDecodedVideoFrame(video).then(() => { resolved = true })

    // dá espaço para qualquer microtask/paint pendente sem a confirmação real
    await new Promise(r => setTimeout(r, 0))
    expect(video.requestVideoFrameCallback).toHaveBeenCalled()
    expect(resolved).toBe(false) // ainda não capturaria — é exatamente essa a proteção contra o borrão

    deliverFrame()
    await promise
    expect(resolved).toBe(true)
  })

  it('espera o vídeo ficar pronto (loadeddata/canplay) antes de pedir o frame', async () => {
    const video = fakeVideo({ readyState: 0 })
    video.requestVideoFrameCallback = vi.fn(cb => cb())

    const promise = waitForDecodedVideoFrame(video)
    await new Promise(r => setTimeout(r, 0))
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled()

    video.readyState = 2
    video.dispatchEvent(new Event('loadeddata'))
    await promise
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1)
  })

  it('sem requestVideoFrameCallback, cai no fallback de dois paints e ainda resolve', async () => {
    const originalRAF = global.requestAnimationFrame
    global.requestAnimationFrame = cb => setTimeout(cb, 0)
    try {
      const video = fakeVideo() // sem requestVideoFrameCallback
      await expect(waitForDecodedVideoFrame(video)).resolves.toBeUndefined()
    } finally {
      global.requestAnimationFrame = originalRAF
    }
  })

  it('rejeita se o vídeo emitir erro', async () => {
    const video = fakeVideo({ readyState: 0 })
    const promise = waitForDecodedVideoFrame(video)
    video.dispatchEvent(new Event('error'))
    await expect(promise).rejects.toThrow()
  })
})
