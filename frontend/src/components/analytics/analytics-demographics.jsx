import { Bar, Doughnut } from 'react-chartjs-2'
import { topN, baseChartOptions, DEMO_COLORS, GENDER_COLORS } from '../../lib/analytics-format.js'

export function AnalyticsDemographics({ net, tab, data }) {
  if (tab !== 'growth') return null
  const demo = net === 'instagram' ? data.instagramDemographics : net === 'youtube' ? data.youtubeDemographics : null
  if (!demo) return null

  const ageGender = demo.ageGender || []
  const country = demo.country || []
  if (!ageGender.length && !country.length) return null

  const ageGenderTitle = net === 'instagram' ? 'Seguidores por idade e gênero' : 'Espectadores por idade e gênero'
  const geoTitle = net === 'instagram' ? 'Seguidores por país' : 'Espectadores por país'

  const faixas = [...new Set(ageGender.map(d => d.age))].sort()
  const generos = [...new Set(ageGender.map(d => d.gender))]

  const geoItens = country.map(c => ({ label: c.country, value: c.value }))
  const geoTop = topN(geoItens, 8)

  return (
    <div className="analytics-demo-grid">
      <div className="an-summary-section">
        <div className="an-summary-section-title">{ageGenderTitle}</div>
        <p className="analytics-section-description">Entenda quem compõe sua audiência.</p>
        <div style={{ position: 'relative', minHeight: 220 }}>
          {ageGender.length
            ? <Bar
                data={{
                  labels: faixas,
                  datasets: generos.map(g => ({
                    label: g,
                    data: faixas.map(f => ageGender.find(d => d.age === f && d.gender === g)?.value || 0),
                    backgroundColor: GENDER_COLORS[g] || '#d1993e',
                    borderRadius: 4,
                  })),
                }}
                options={baseChartOptions()}
              />
            : <p className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>Sem dados disponíveis.</p>}
        </div>
      </div>
      <div className="an-summary-section">
        <div className="an-summary-section-title">{geoTitle}</div>
        <p className="analytics-section-description">Veja de onde vêm as pessoas que acompanham ou assistem seu conteúdo.</p>
        <div style={{ position: 'relative', minHeight: 220 }}>
          {geoTop.length
            ? <Doughnut
                data={{ labels: geoTop.map(i => i.label), datasets: [{ data: geoTop.map(i => i.value), backgroundColor: DEMO_COLORS }] }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#8b8fa3', boxWidth: 12, font: { size: 11 } } } } }}
              />
            : <p className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>Sem dados disponíveis.</p>}
        </div>
      </div>
    </div>
  )
}
