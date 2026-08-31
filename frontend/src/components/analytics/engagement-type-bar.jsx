import { fmtNum } from '../../lib/analytics-format.js'

export function EngagementTypeBar({ icon, label, value, max }) {
  const percent = value == null || !max ? 0 : (value / max) * 100
  return (
    <div className="an-eng-type-row">
      <div className="an-eng-type-head">
        <span className="an-eng-type-name">{icon} {label}</span>
        <span className="an-eng-type-val">{fmtNum(value)}</span>
      </div>
      <div className="an-eng-type-bar"><div className="an-eng-type-bar-fill" style={{ width: `${percent}%` }}/></div>
    </div>
  )
}
