const sharp = require('sharp')
const { converterImagemParaTiktok } = require('../../../../src/infra/storage/mediaConverter')

describe('converterImagemParaTiktok', () => {
  test('entrega canvas 1080x1920 sem cortar uma foto horizontal', async () => {
    const input = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 220, g: 20, b: 20 } }
    }).jpeg().toBuffer()

    const output = await converterImagemParaTiktok(input)
    const metadata = await sharp(output).metadata()
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    const topLeft = [data[0], data[1], data[2]]
    const center = ((Math.floor(info.height / 2) * info.width) + Math.floor(info.width / 2)) * info.channels
    const centerPixel = [data[center], data[center + 1], data[center + 2]]

    expect(metadata).toMatchObject({ width: 1080, height: 1920, format: 'jpeg' })
    expect(topLeft).toEqual([255, 255, 255])
    expect(centerPixel[0]).toBeGreaterThan(150)
    expect(centerPixel[1]).toBeLessThan(100)
    expect(centerPixel[2]).toBeLessThan(100)
  })
})
