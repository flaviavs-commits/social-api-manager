// Static light plates are composited, rather than repainting giant gradients.
export function StoryAtmosphere({ features, plateRefs }) {
  return <div className="story-atmosphere" aria-hidden="true" inert>
    <div className="story-ambient-lights">{features.map(([type], i) => <div key={type}
      ref={node => { plateRefs.current[i] = node }} className={`story-ambient-plate story-ambient-plate--${i}`} />)}</div>
    <div className="story-far-space"><div className="story-depth-frame"><span>Conteúdo</span><b>Crie.<br />Agende.<br />Publique.</b></div></div>
    <div className="story-mid-space"><div className="story-depth-strip"><span>Rascunho</span><i /><span>Agendado</span><i /><span>Publicado</span></div></div>
    <div className="story-near-space"><div className="story-passing-frame"><span>Ecoo Mídia</span><b>Suas redes.<br />Um só lugar.</b></div></div>
  </div>
}
