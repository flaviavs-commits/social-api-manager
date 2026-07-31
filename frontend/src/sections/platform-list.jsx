const platforms = ['YouTube', 'Instagram', 'TikTok', 'Facebook']

export function PlatformList() {
  return <ul className="platform-list" aria-label="Plataformas suportadas">{platforms.map(platform => <li key={platform}>{platform}</li>)}</ul>
}
