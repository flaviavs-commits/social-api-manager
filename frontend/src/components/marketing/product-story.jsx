import { useEffect, useMemo, useRef, useState } from 'react'
import { clampProgress, getSceneChoreography, getStoryEnvironment, getStoryFrame } from './story-progress.js'
import { StoryAtmosphere } from './story-atmosphere.jsx'
import logo from '../../../../public/logo.png'
import '../../styles/product-story.css'
import '../../styles/story-environment.css'

const NETWORKS = ['instagram', 'facebook', 'tiktok', 'youtube']
const LABELS = ['Instagram', 'Facebook', 'TikTok', 'YouTube']
const ORDER = ['calendar', 'sparkle', 'repeat', 'message', 'link', 'chart']

function EditorialContent({ compact = false }) {
  return <div className={`story-editorial${compact ? ' story-editorial--compact' : ''}`}>
    <img src={logo} alt="" width="145" height="65" draggable="false" />
    <strong>Sua rotina<br />nas redes,<br /><em>resolvida.</em></strong>
    <span>Menos tempo nas tarefas.<br />Mais tempo nas ideias.</span>
  </div>
}

function HeroContentObject({ Icon }) {
  return <div className="story-hero-body">
    <div className="story-hero-bg" />
    <div className="story-hero-meta"><span>Ecoo Mídia</span><span>Publicação <Icon name="dots" size={16} /></span></div>
    <div className="story-hero-media"><EditorialContent /></div>
    <div className="story-hero-caption"><Icon name="bookmark" size={16} /><span>Crie, agende e acompanhe.</span><Icon name="check" size={15} /></div>
    <div className="story-hero-status">
      <span className="st st--sched"><Icon name="clock" size={14} />Agendado</span>
      <span className="st st--ready"><Icon name="check" size={14} />Pronto para publicar</span>
      <span className="st st--done"><Icon name="check" size={14} />Publicado</span>
    </div>
  </div>
}

function Calendar({ Icon }) {
  return <><div className="story-plane-heading"><Icon name="calendar" size={18} /><b>Agendamento</b><span>Sua semana</span></div>
    <div className="story-calendar-grid">{['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map((day, i) => <div key={day} className={i === 2 ? 'selected' : ''}><small>{day}</small><b>{i + 14}</b><span /><span /></div>)}</div>
    <div className="story-calendar-footer"><Icon name="clock" size={16} /><span>Escolha os horários.</span><Icon name="check" size={16} /></div></>
}

export function ProductStory({ features, Icon, BrandGlyph }) {
  // Existing copy, verbatim. Reports now close the journey.
  const scenes = useMemo(() => [...features].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])), [features])
  const sectionRef = useRef(null), stageRef = useRef(null), railRef = useRef(null), orbRef = useRef(null)
  const worldRef = useRef(null), cameraRef = useRef(null), heroRef = useRef(null)
  const props = useRef({}), copies = useRef([]), markers = useRef([]), plates = useRef({}), nodes = useRef([])
  const paths = useRef([]), pulses = useRef([]), routesRef = useRef(null), graphRef = useRef(null)
  const [active, setActive] = useState(0)
  const count = scenes.length

  useEffect(() => {
    const section = sectionRef.current, stage = stageRef.current, world = worldRef.current, rail = railRef.current
    if (!section || !stage || !world || !rail) return undefined
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let raf = 0, lastActive = -1, w = 1, h = 1, top = 0, runway = 1, railH = 1, railTop = 0, compact = false, maxScale = 2, cameraY = 0
    const bounds = new Map()
    let lastProgress = -1, lastReduced = false
    const measure = () => {
      lastProgress = -1
      w = Math.max(1, world.clientWidth); h = Math.max(1, world.clientHeight)
      top = parseFloat(getComputedStyle(stage).top) || 0
      runway = Math.max(1, section.offsetHeight - stage.clientHeight)
      railH = rail.clientHeight; railTop = rail.offsetTop
      compact = window.innerWidth <= 860 && window.innerHeight > 520
      const heroW = heroRef.current?.offsetWidth || 350, heroH = heroRef.current?.offsetHeight || 370
      maxScale = Math.max(.65, Math.min(compact ? 1.1 : 2, h * .87 / heroH, w * (compact ? .85 : .66) / heroW))
      for (const node of [heroRef.current, ...Object.values(props.current), ...nodes.current]) if (node) bounds.set(node, [node.offsetWidth, node.offsetHeight])
      routesRef.current?.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
    const point = o => [(compact ? .35 : .5) * w + o.x * w * (compact ? .65 : 1), h * .5 + o.y * h]
    const apply = (node, o, isHero = false) => {
      if (!node) return
      const presence = o.presence ?? 1
      if (presence < .001) { node.style.visibility = 'hidden'; node.style.opacity = '0'; return }
      let [x, y] = point(o)
      const [ow, oh] = bounds.get(node) || [1, 1]
      const scale = Math.min(isHero ? Math.min(o.scale, maxScale) : o.scale, (h - 24) / oh)
      const halfW = ow * scale / 2 + 9, halfH = oh * scale / 2 + 9
      x = Math.max(halfW, Math.min(w - halfW, x))
      y = Math.max(halfH - cameraY, Math.min(h - halfH - cameraY, y))
      node.style.visibility = 'visible'; node.style.opacity = presence.toFixed(4)
      node.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${o.z.toFixed(1)}px) translate(-50%,-50%) rotateY(${o.ry.toFixed(2)}deg) rotateX(${o.rx.toFixed(2)}deg) scale(${scale.toFixed(4)})`
    }
    const update = () => {
      raf = 0
      const rect = section.getBoundingClientRect()
      const p = clampProgress((top - rect.top) / runway)
      const s = p * (count - 1), next = Math.round(s), reduced = media?.matches || false
      if (lastProgress === p && lastReduced === reduced) return
      lastProgress = p; lastReduced = reduced
      const f = getSceneChoreography(s, 1, { count, reducedMotion: reduced, depth: compact ? .12 : .6, camera: compact ? 0 : 1 })
      const env = getStoryEnvironment(p, count, reduced)
      section.style.setProperty('--story-progress', p.toFixed(6))
      section.style.setProperty('--camera-far-y', `${env.farY}px`)
      section.style.setProperty('--camera-mid-y', `${env.midY * (compact ? .4 : 1)}px`)
      section.style.setProperty('--camera-near-y', `${env.nearY}px`)
      section.style.setProperty('--ambient-light-x', `${env.lightX}px`)
      section.style.setProperty('--ambient-light-y', `${env.lightY}px`)
      section.style.setProperty('--near-presence', reduced || compact ? '0' : (f.fullFrame * .14).toFixed(4))
      section.style.setProperty('--playhead-y', `${railTop + p * railH}px`)
      section.style.setProperty('--connection-presence', (f.connection * (1 - f.fullFrame)).toFixed(4))
      section.style.setProperty('--spine-presence', (1 - f.fullFrame * .88).toFixed(4))
      env.weights.forEach((v, i) => { if (plates.current[i]) plates.current[i].style.opacity = v.toFixed(4) })
      orbRef.current.style.transform = `translate3d(-50%,${p * railH}px,0) scale(${1 + (reduced ? 0 : f.connection ** 8 * .08)})`
      markers.current.forEach((node, i) => node?.style.setProperty('--node-presence', Math.max(0, 1 - Math.abs(s - i) * 3).toFixed(4)))
      copies.current.forEach((copy, i) => {
        if (!copy) return
        const cf = getStoryFrame(p, i, count, reduced)
        copy.style.visibility = cf.textOpacity > .001 ? 'visible' : 'hidden'
        copy.style.setProperty('--text-opacity', cf.textOpacity.toFixed(4))
        copy.style.setProperty('--text-scale', cf.textScale.toFixed(4))
        copy.style.setProperty('--copy-y', `${cf.y}px`)
        copy.style.setProperty('--copy-blur', `${cf.blur}px`)
        for (const key of ['label', 'heading', 'description', 'counter']) copy.style.setProperty(`--${key}`, cf[key].toFixed(4))
      })
      cameraY = compact ? 0 : f.cam.y * Math.min(1, h / 650)
      cameraRef.current.style.transform = `translate3d(0,${cameraY}px,0) rotateY(${f.cam.ry}deg)`
      apply(heroRef.current, f.hero, true)
      heroRef.current.style.setProperty('--explode', f.hero.explode.toFixed(4))
      heroRef.current.style.setProperty('--st-sched', f.hero.scheduled.toFixed(4))
      heroRef.current.style.setProperty('--st-ready', f.hero.ready.toFixed(4))
      heroRef.current.style.setProperty('--st-done', f.hero.published.toFixed(4))
      for (const key of ['calendar', 'creation', 'library', 'inbox', 'bio', 'reports']) apply(props.current[key], { ...f[key], presence: f[key].presence * (1 - f.fullFrame) })
      props.current.library?.style.setProperty('--spread', (1 - Math.min(1, Math.abs(s - 2))).toFixed(4))
      graphRef.current?.style.setProperty('stroke-dashoffset', (1 - f.graph).toFixed(4))
      routesRef.current.style.opacity = f.paths.presence.toFixed(4)
      const [hx, hy] = point(f.hero)
      f.nodes.forEach((node, i) => {
        const placed = compact ? { ...node, x: i < 2 ? -.36 : .83, y: node.y * 1.12 } : node
        apply(nodes.current[i], placed)
        const [nx, ny] = point(placed), cx = (hx + nx) / 2
        paths.current[i]?.setAttribute('d', `M${hx} ${hy}C${cx} ${hy},${cx} ${ny},${nx} ${ny}`)
        paths.current[i]?.style.setProperty('stroke-dashoffset', (1 - node.draw).toFixed(4))
        const pulse = clampProgress((node.draw - .5) * 2), u = 1 - pulse
        if (pulses.current[i]) {
          const px = u ** 3 * hx + 3 * u * u * pulse * cx + 3 * u * pulse * pulse * cx + pulse ** 3 * nx
          const py = (u ** 3 + 3 * u * u * pulse) * hy + (3 * u * pulse * pulse + pulse ** 3) * ny
          pulses.current[i].setAttribute('cx', px); pulses.current[i].setAttribute('cy', py)
          pulses.current[i].style.opacity = (Math.sin(pulse * Math.PI) ** 2).toFixed(4)
        }
      })
      if (next !== lastActive) { lastActive = next; setActive(next) }
    }
    const request = () => { if (!raf) raf = requestAnimationFrame(update) }
    const resize = () => { measure(); request() }
    measure(); update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    observer?.observe(stage); observer?.observe(section)
    window.addEventListener('scroll', request, { passive: true }); window.addEventListener('resize', resize)
    media?.addEventListener?.('change', request)
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); window.removeEventListener('scroll', request); window.removeEventListener('resize', resize); media?.removeEventListener?.('change', request) }
  }, [count])

  const goToStep = index => {
    const section = sectionRef.current, stage = stageRef.current
    const top = parseFloat(getComputedStyle(stage).top) || 0
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - top + (section.offsetHeight - stage.clientHeight) * index / Math.max(1, count - 1), behavior: 'instant' })
  }
  return <div className="mkt-product-story" ref={sectionRef} role="region" aria-label="Recursos em destaque" style={{ '--story-count': count }}>
    <div className="story-stage" ref={stageRef}>
      <StoryAtmosphere features={scenes} plateRefs={plates} />
      <div className="story-stage-top"><span>Do primeiro rascunho ao relatório.</span><a href="#como-funciona">Pular etapas <Icon name="arrow" size={15} /></a></div>
      <nav className="story-rail" ref={railRef} aria-label="Etapas dos recursos">
        <span className="story-track" /><span className="story-progress" />
        {scenes.map(([, label], i) => <button type="button" key={label} ref={node => { markers.current[i] = node }} style={{ '--marker-position': `${i / (count - 1) * 100}%` }} aria-label={`Etapa ${i + 1}: ${label}`} aria-current={active === i ? 'step' : undefined} onClick={() => goToStep(i)}><span /></button>)}
        <span className="story-indicator" ref={orbRef} aria-hidden="true"><i /></span>
      </nav>
      <div className="story-playhead-connection" aria-hidden="true" />
      <div className="story-layers">
        {scenes.map(([icon, label, title, text], i) => <article key={icon} ref={node => { copies.current[i] = node }} className={`story-step${active === i ? ' is-active' : ''}`} data-placement={i} aria-hidden={active !== i} inert={active !== i} aria-labelledby={`story-title-${icon}`}>
          <div className="story-copy"><div className="story-label"><Icon name={icon} size={18} /><span>{label}</span></div><h3 id={`story-title-${icon}`}>{title}</h3><p>{text}</p><span className="story-step-number">{String(i + 1).padStart(2, '0')}<span> / {String(count).padStart(2, '0')}</span></span></div>
        </article>)}
        <div className="story-world" ref={worldRef} aria-hidden="true" inert>
          <div className="story-scene-root" ref={cameraRef}>
            <svg className="story-routes" ref={routesRef} fill="none">{NETWORKS.map((name, i) => <g key={name}><path ref={node => { paths.current[i] = node }} pathLength="1" /><circle r="3" ref={node => { pulses.current[i] = node }} /></g>)}</svg>
            <div className="story-obj story-plane story-calendar" ref={node => { props.current.calendar = node }}><Calendar Icon={Icon} /></div>
            <div className="story-obj story-plane story-creation" ref={node => { props.current.creation = node }}>
              <div className="story-plane-heading"><Icon name="sparkle" size={18} /><b>Criação assistida</b></div><div className="story-editor-tabs"><span>Mídia</span><span>Legenda</span><span>Prévia</span></div>
              <div className="story-editor-tools"><Icon name="sparkle" size={18} /><span>Sistema inteligente</span><Icon name="check" size={16} /></div>
            </div>
            <div className="story-obj story-library" ref={node => { props.current.library = node }}>
              {[0, 1].map(i => <div key={i} className={`story-library-piece story-library-piece--${i}`}><EditorialContent compact /><span>{i ? 'Rascunhos' : 'Biblioteca'}</span></div>)}
              <span className="story-library-action"><Icon name="repeat" size={18} />Reaproveitar conteúdo</span>
            </div>
            <div className="story-obj story-plane story-inbox" ref={node => { props.current.inbox = node }}>
              <div className="story-plane-heading"><Icon name="message" size={18} /><b>Caixa de entrada</b></div>
              {[0, 1, 3].map(i => <div className="story-inbox-row" key={i}><BrandGlyph name={NETWORKS[i]} size={20} /><b>{LABELS[i]}</b><span>Comentários</span><Icon name="arrow" size={14} /></div>)}
              <div className="story-inbox-footer"><Icon name="message" size={17} />Responder em um só lugar <Icon name="send" size={16} /></div>
            </div>
            <div className="story-obj story-bio" ref={node => { props.current.bio = node }}><Icon name="link" size={17} /><span>Link na bio</span><Icon name="arrow" size={16} /></div>
            <div className="story-obj story-plane story-reports" ref={node => { props.current.reports = node }}>
              <div className="story-plane-heading"><Icon name="chart" size={18} /><b>Relatórios</b><span>Visão geral</span></div>
              <div className="story-report-tabs"><b>Alcance</b><span>Engajamento</span><span>Crescimento</span></div>
              <svg className="story-graph" viewBox="0 0 450 180" fill="none"><path className="story-graph-grid" d="M12 30H438M12 85H438M12 140H438" /><path className="story-graph-line" pathLength="1" ref={graphRef} d="M12 139C50 139 45 80 88 88S141 137 180 86 219 90 260 52 297 77 330 35 399 40 438 16" /></svg>
              <div className="story-report-foot"><span>Publicações</span><span>Redes sociais</span></div>
            </div>
            {NETWORKS.map((name, i) => <div key={name} className={`story-obj story-social story-social--${name}`} ref={node => { nodes.current[i] = node }}><div className="story-social-face"><BrandGlyph name={name} size={30} /></div><span>{LABELS[i]}</span></div>)}
            <div className="story-obj story-hero" ref={heroRef}><HeroContentObject Icon={Icon} /></div>
          </div>
        </div>
      </div>
      <div className="story-stage-bottom"><span>Role para continuar <Icon name="arrow" size={15} /></span><span>Prévia ilustrativa dos recursos</span></div>
    </div>
  </div>
}
