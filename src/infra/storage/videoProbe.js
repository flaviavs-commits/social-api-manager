const { spawn } = require('child_process')
const ffprobeStatic = require('ffprobe-static')

const FFPROBE_TIMEOUT_MS = 20_000
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024

function probeVideo(absPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobeStatic.path, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type,width,height,duration,tags,side_data_list:format=duration',
      '-of', 'json',
      absPath
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let timedOut = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) return reject(error)
      resolve(value)
    }

    const terminate = () => {
      if (!child.killed) child.kill('SIGKILL')
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
      finish(new Error('A análise do vídeo excedeu o tempo limite.'))
    }, FFPROBE_TIMEOUT_MS)

    child.stdout.on('data', chunk => {
      stdout = Buffer.concat([stdout, chunk])
      if (stdout.length > MAX_OUTPUT_BYTES) {
        terminate()
        finish(new Error('A saída de metadados do vídeo excedeu o limite.'))
      }
    })

    child.stderr.on('data', chunk => {
      stderr = Buffer.concat([stderr, chunk])
      if (stderr.length > MAX_OUTPUT_BYTES) stderr = stderr.subarray(stderr.length - MAX_OUTPUT_BYTES)
    })

    child.on('error', error => finish(error))
    child.on('close', (code, signal) => {
      if (settled) return
      if (timedOut) return finish(new Error('A análise do vídeo excedeu o tempo limite.'))
      if (code !== 0) {
        const detail = stderr.toString('utf8').trim().slice(0, 300)
        return finish(new Error(detail || `ffprobe encerrou com código ${code ?? 'desconhecido'}${signal ? ` (${signal})` : ''}`))
      }

      let data
      try {
        data = JSON.parse(stdout.toString('utf8'))
      } catch {
        return finish(new Error('Não foi possível ler os metadados do vídeo.'))
      }

      const stream = Array.isArray(data.streams) ? data.streams.find(item => item.codec_type === 'video') : null
      if (!stream) return finish(new Error('Nenhum stream de vídeo encontrado'))

      let { width, height } = stream
      // Aplica rotação (vídeos gravados na vertical no celular costumam vir
      // com width/height de paisagem + metadado de rotação 90/270).
      const rotation = parseInt(stream.tags?.rotate || stream.side_data_list?.find(item => item.rotation)?.rotation || 0, 10)
      if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
        ;[width, height] = [height, width]
      }

      const duration = parseFloat(data.format?.duration || stream.duration || 0)
      finish(null, { width, height, duration })
    })
  })
}

module.exports = { probeVideo, FFPROBE_TIMEOUT_MS, MAX_OUTPUT_BYTES }
