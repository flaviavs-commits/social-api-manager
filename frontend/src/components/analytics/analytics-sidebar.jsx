import { NET_ICONS, PLAT_LABELS } from '../../lib/analytics-format.js'

export function AnalyticsSidebar({ networks, activeNet, onSelect }) {
  return (
    <nav className="analytics-sidebar" aria-label="Redes sociais">
      <div className="analytics-sidebar-label">Escolha uma rede</div>
      <p className="analytics-sidebar-help">Comece pela rede que deseja entender.</p>
      {networks.length
        ? networks.map(net => (
            <button
              key={net}
              type="button"
              className={`analytics-net-item${net === activeNet ? ' active' : ''}`}
              aria-pressed={net === activeNet}
              onClick={() => onSelect(net)}
            >
              {NET_ICONS[net]} {PLAT_LABELS[net]}
            </button>
          ))
        : <p className="empty-state" style={{ fontSize: 12, padding: 8 }}>Nenhuma rede com dados.</p>}
    </nav>
  )
}
