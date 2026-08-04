import { NET_ICONS, PLAT_LABELS } from '../../lib/analytics-format.js'

export function AnalyticsSidebar({ networks, activeNet, onSelect }) {
  return (
    <div className="analytics-sidebar">
      <div className="analytics-sidebar-label">Redes</div>
      {networks.length
        ? networks.map(net => (
            <div
              key={net}
              className={`analytics-net-item${net === activeNet ? ' active' : ''}`}
              onClick={() => onSelect(net)}
            >
              {NET_ICONS[net]} {PLAT_LABELS[net]}
            </div>
          ))
        : <p className="empty-state" style={{ fontSize: 12, padding: 8 }}>Nenhuma rede com dados.</p>}
    </div>
  )
}
