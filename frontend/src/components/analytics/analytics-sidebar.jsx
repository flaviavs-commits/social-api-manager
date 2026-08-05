import { NETWORK_ORDER, PLAT_LABELS } from '../../lib/analytics-format.js'
import { PlatformIcon } from '../ui/platform-icon.jsx'

export function AnalyticsSidebar({ networks, activeNet, onSelect }) {
  const availableNetworks = new Set(networks)
  return (
    <nav className="analytics-sidebar" aria-label="Redes sociais">
      <div className="analytics-sidebar-label">Escolha uma rede</div>
      <p className="analytics-sidebar-help">Comece pela rede que deseja entender.</p>
      {NETWORK_ORDER.map(net => {
          const available = availableNetworks.has(net)
          return (
            <button
              key={net}
              type="button"
              disabled={!available}
              className={`analytics-net-item${net === activeNet ? ' active' : ''}${available ? '' : ' unavailable'}`}
              aria-pressed={net === activeNet}
              aria-label={`${PLAT_LABELS[net]}${available ? '' : ' — sem conexão'}`}
              onClick={() => available && onSelect(net)}
            >
              <span className="analytics-net-item-content">
                <span className={`analytics-net-item-icon analytics-net-item-icon-${net}`} aria-hidden="true">
                  <PlatformIcon platform={net} className="h-4 w-4" />
                </span>
                <span>{PLAT_LABELS[net]}</span>
              </span>
              {net === activeNet && <span className="analytics-net-item-check" aria-hidden="true">✓</span>}
              {!available && <span className="analytics-net-item-status">Sem conexão</span>}
            </button>
          )
        })}
    </nav>
  )
}
