export const clampProgress = value => Math.max(0, Math.min(1, value))
const smooth = (a, b, value) => {
  const t = clampProgress((value - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * smooth(keys[i - 1][0], keys[i][0], t)
  }
  return keys.at(-1)[1]
}
export function getStoryFrame(progress, index, count, reducedMotion = false) {
  const local = clampProgress(progress) * Math.max(1, count - 1) - index
  const fade = smooth(.23, .68, Math.abs(local))
  const presence = 1 - fade
  const textOpacity = clampProgress((presence - .5) * 2)
  return {
    opacity: presence, textOpacity,
    x: 0, y: reducedMotion ? 0 : fade * (local < 0 ? 26 : -28),
    z: reducedMotion ? 0 : -180 * fade,
    rotation: reducedMotion ? 0 : fade * (local < 0 ? -8 : 6),
    scale: reducedMotion ? 1 : 1 - fade * .08,
    textScale: reducedMotion ? 1 : 1 + fade * (local < 0 ? -.18 : .13) + (1 - fade) * local * .045,
    blur: reducedMotion ? 0 : fade * 4,
    label: smooth(0, .5, textOpacity), heading: smooth(0, .8, textOpacity),
    description: smooth(.15, 1, textOpacity), counter: smooth(.2, 1, textOpacity),
  }
}
// No clock or velocity accumulator: the same scroll position gives the same frame.
export function getStoryEnvironment(progress, count = 6, reducedMotion = false) {
  const s = clampProgress(progress) * (count - 1)
  const from = Math.floor(s), to = Math.min(count - 1, from + 1)
  const blend = smooth(0, 1, s - from)
  return {
    weights: Array.from({ length: count }, (_, i) => i === from ? 1 - blend : i === to ? blend : 0),
    farY: reducedMotion ? 0 : 70 - progress * 180,
    midY: reducedMotion ? 0 : 150 - progress * 380,
    nearY: reducedMotion ? 0 : 240 - progress * 600,
    lightX: reducedMotion ? 0 : track([[0, -60], [1, 100], [2, -80], [3, 110], [4, -30], [5, 60]], s),
    lightY: reducedMotion ? 0 : 90 - progress * 190,
  }
}
const windowPresence = (s, start, focus, endFocus, end) => smooth(start, focus, s) * (1 - smooth(endFocus, end, s))
const pose = (x, y, z = 0, scale = 1, ry = 0, rx = 0, presence = 1) => ({ x, y, z, scale, ry, rx, presence })
const HERO = {
  x: [[0, .20], [.48, .08], [1, .25], [1.5, .13], [2, .25], [2.5, 0], [3, .10], [3.5, .09], [4, .25], [4.5, .14], [5, .15]],
  y: [[0, .10], [.48, -.13], [1, .03], [1.5, -.14], [2, .07], [2.5, 0], [3, .28], [3.5, -.14], [4, 0], [4.5, -.16], [5, .20]],
  z: [[0, 10], [.48, 180], [1, 40], [1.5, 120], [2, 30], [2.5, 100], [3, 0], [3.5, 110], [4, 20], [4.5, 130], [5, 40]],
  scale: [[0, .76], [.48, 1.23], [1, 1.06], [1.5, .9], [2, .97], [2.5, 1.95], [3, .62], [3.5, 1.12], [4, .72], [4.5, 1.07], [5, .56]],
  ry: [[0, -7], [.48, -12], [1, -6], [1.5, 9], [2, -5], [2.5, 0], [3, -5], [3.5, 8], [4, -2], [4.5, 9], [5, -6]],
}
// Existing copy: planning, creation, reuse, inbox after publication, channels/bio,
// reports. One persistent content object connects these six real capabilities.
export function getSceneChoreography(stageCoord, dock = 1, options = {}) {
  const { reducedMotion = false, depth = 1, camera = 1, count = 6 } = options
  const s = Math.max(0, Math.min(count - 1, stageCoord))
  const motion = reducedMotion ? 0 : 1, layer = depth * motion
  const intro = (1 - clampProgress(dock)) * motion
  const hero = pose(track(HERO.x, s) + intro * .06, track(HERO.y, s),
    (track(HERO.z, s) + intro * 230) * layer,
    reducedMotion ? 1 : track(HERO.scale, s), track(HERO.ry, s) * motion, 3 * motion)
  if (reducedMotion) { hero.x = .24; hero.y = .10; hero.ry = 0 }
  hero.explode = track([[0, 0], [.65, .1], [.98, 1], [1.15, .8], [1.55, 0]], s) * layer
  hero.scheduled = (1 - smooth(.15, .6, s)) * clampProgress(dock)
  hero.ready = windowPresence(s, 2.63, 2.73, 2.82, 2.9)
  hero.published = smooth(2.91, 3, s)
  const prop = (index, x, y, z, ry = -7) => {
    const local = s - index
    return pose(x, y - local * .26 * motion, (z - Math.abs(local) * 290) * layer, 1, ry * motion, 4 * motion,
      windowPresence(s, index - .58, index - .15, index + .20, index + .63))
  }
  const calendar = prop(0, .27, -.035, -130)
  calendar.presence = 1 - smooth(.22, .66, s)
  const creation = prop(1, .30, -.06, -115)
  const library = prop(2, .27, -.035, -60)
  const inbox = prop(3, .32, -.08, -25)
  const bio = prop(4, .27, .035, -130, 0)
  const reports = prop(5, .28, -.045, -65, -3)
  reports.presence = smooth(4.43, 4.87, s)
  const channelPresence = windowPresence(s, 3.45, 3.88, 4.25, 4.73)
  const nodes = [[.115, -.24, 30], [.10, .21, -20], [.415, -.20, 50], [.41, .23, 0]].map(([x, y, z], i) => {
    const enter = smooth(3.48 + i * .035, 3.97 + i * .025, s)
    const exit = smooth(4.25, 4.73, s)
    return { ...pose(x, y + (1 - enter) * .16 - exit * .22, (z - (1 - enter) * 160 - exit * 240) * layer,
      .86 + enter * .14, [8, -8, -8, 8][i] * motion, 5 * motion, channelPresence),
      reaction: Math.sin(enter * Math.PI) ** 2, draw: enter }
  })
  return {
    s, hero, calendar, creation, library, inbox, bio, reports, nodes,
    cam: { y: reducedMotion ? 0 : -s * 11, ry: reducedMotion ? 0 : Math.sin(s * Math.PI) * 1.5 * camera, rx: 0, scale: 1 },
    paths: { presence: channelPresence, draw: smooth(3.5, 4.12, s), data: smooth(4.35, 4.92, s) },
    fullFrame: Math.sin(Math.PI * clampProgress((s - 2.26) / .48)) ** 2,
    graph: smooth(4.65, 5, s), connection: 1 - Math.abs(s - Math.round(s)) * 2,
  }
}
