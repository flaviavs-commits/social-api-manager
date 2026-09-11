import { getSceneChoreography, getStoryEnvironment, getStoryFrame, track } from '../../src/components/marketing/story-progress.js'

describe('continuous product story', () => {
  const count = 6
  it('never presents two readable titles simultaneously', () => {
    for (let tick = 0; tick <= 1000; tick++) {
      const frames = Array.from({ length: count }, (_, i) => getStoryFrame(tick / 1000, i, count))
      expect(frames.filter(f => f.textOpacity > .001).length).toBeLessThanOrEqual(1)
      expect(frames.filter(f => f.opacity > .501).length).toBeLessThanOrEqual(1)
    }
  })
  it('gives all six existing resources a sharp reading frame', () => {
    for (let i = 0; i < count; i++) {
      expect(getStoryFrame(i / (count - 1), i, count)).toMatchObject({ textOpacity: 1, blur: 0, textScale: 1 })
      expect(getSceneChoreography(i).hero.presence).toBe(1)
    }
  })
  it('interpolates keyframes continuously and holds the ends', () => {
    const keys = [[0, 0], [1, 10], [2, 10], [3, 0]]
    expect(track(keys, -1)).toBe(0)
    expect(track(keys, .5)).toBeCloseTo(5)
    expect(track(keys, 1.5)).toBe(10)
    expect(track(keys, 9)).toBe(0)
  })
  it('replays the exact same frames on reverse and drives the environment from the same progress', () => {
    const positions = [0, .12, .38, .5, .62, .8, .95, 1]
    const frame = p => [getSceneChoreography(p * 5), getStoryEnvironment(p), getStoryFrame(p, 2, 6)]
    expect(positions.toReversed().map(frame).reverse()).toEqual(positions.map(frame))
    for (const p of positions) expect(getStoryEnvironment(p).weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(getStoryEnvironment(1).farY).toBeLessThan(getStoryEnvironment(0).farY)
    expect(getStoryEnvironment(1).midY).toBeLessThan(getStoryEnvironment(1).farY)
    expect(getStoryEnvironment(1).nearY).toBeLessThan(getStoryEnvironment(1).midY)
  })
  it('keeps the same protagonist present through the viewport-scale handoff', () => {
    const peak = getSceneChoreography(2.5)
    expect(peak.hero.x).toBe(0)
    expect(peak.hero.scale).toBeGreaterThan(1.8)
    expect(peak.fullFrame).toBeCloseTo(1)
    expect(peak.nodes.every(n => n.presence === 0)).toBe(true)
    expect(getStoryFrame(.5, 2, 6).textOpacity).toBe(0)
    expect(getStoryFrame(.5, 3, 6).textOpacity).toBe(0)
  })
  it('separates creation layers, distributes to four channels, then closes in reports', () => {
    expect(getSceneChoreography(1).hero.explode).toBeGreaterThan(.9)
    expect(getSceneChoreography(2).hero.explode).toBe(0)
    const channels = getSceneChoreography(4)
    expect(channels.nodes).toHaveLength(4)
    expect(channels.nodes.every(n => n.presence === 1)).toBe(true)
    const end = getSceneChoreography(5)
    expect(end.reports.presence).toBe(1)
    expect(end.graph).toBe(1)
    expect(end.paths.presence).toBe(0)
    expect(end.hero.published).toBe(1)
  })
  it('never overlaps ready and published statuses', () => {
    for (let s = 2.5; s < 3.2; s += .01) {
      const h = getSceneChoreography(s).hero
      expect(h.ready > .001 && h.published > .001).toBe(false)
    }
  })
  it('removes zoom, rotations, depth and camera travel for reduced motion', () => {
    for (const s of [0, .5, 1.5, 2.5, 4, 5]) {
      const f = getSceneChoreography(s, 1, { reducedMotion: true })
      expect(f.cam).toEqual({ ry: 0, rx: 0, scale: 1, y: 0 })
      expect(f.hero).toMatchObject({ x: .24, y: .1, z: 0, ry: 0, rx: 0, scale: 1, explode: 0, presence: 1 })
      expect(getStoryEnvironment(s / 5, 6, true)).toMatchObject({ farY: 0, midY: 0, nearY: 0, lightX: 0, lightY: 0 })
    }
  })
})
