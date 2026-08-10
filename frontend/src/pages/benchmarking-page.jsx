import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useToast } from '../components/ui/toast.jsx'

const PLATFORMS = [
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'],
]

const PLATFORM_LABELS = Object.fromEntries(PLATFORMS)

function today() {
  return new Date().toISOString().slice(0, 10)
}

function emptyProfileForm() {
  return { name: '', platform: 'instagram', handle: '', profileUrl: '', niche: '' }
}

function emptySnapshotForm() {
  return { capturedOn: today(), followers: '', postsLast30Days: '', avgLikes: '', avgComments: '', avgShares: '', avgViews: '', avgSaves: '', sourceUrl: '', collectionMethod: 'manual' }
}

function fmtNumber(value) {
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0))
}

function fmtPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

function platformClass(platform) {
  return `benchmark-platform benchmark-platform-${platform}`
}

function monitorLabel(monitor) {
  if (!monitor?.enabled) return 'manual'
  return { idle: 'aguardando', syncing: 'sincronizando', active: 'ativo', error: 'erro', unsupported: 'sem fonte' }[monitor.status] || 'aguardando'
}

function Metric({ label, value, hint }) {
  return <div className="benchmark-metric"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>
}

export function BenchmarkingPage() {
  const [data, setData] = useState({ competitors: [], summary: {} })
  const [loading, setLoading] = useState(true)
  const [profileForm, setProfileForm] = useState(emptyProfileForm)
  const [snapshotForm, setSnapshotForm] = useState(emptySnapshotForm)
  const [selectedId, setSelectedId] = useState(null)
  const [nicheFilter, setNicheFilter] = useState('all')
  const [history, setHistory] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingSnapshot, setSavingSnapshot] = useState(false)
  const [monitorBusyId, setMonitorBusyId] = useState(null)
  const notify = useToast()

  const load = useCallback(async (focusId = null) => {
    setLoading(true)
    try {
      const result = await apiFetch('/api/competitors')
      setData({ competitors: result.competitors || [], summary: result.summary || {} })
      setSelectedId(current => focusId || current || result.competitors?.[0]?.id || null)
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { load() }, [load])

  const niches = useMemo(() => data.summary.niches || [...new Set(data.competitors.map(item => item.niche))].sort(), [data])
  const visibleProfiles = useMemo(() => {
    const profiles = nicheFilter === 'all' ? data.competitors : data.competitors.filter(item => item.niche === nicheFilter)
    return [...profiles].sort((a, b) => Number(b.latestSnapshot?.engagementRate || 0) - Number(a.latestSnapshot?.engagementRate || 0))
  }, [data.competitors, nicheFilter])
  const selectedProfile = data.competitors.find(item => item.id === selectedId) || null

  function updateProfileField(event) {
    setProfileForm(current => ({ ...current, [event.target.name]: event.target.value }))
  }

  function updateSnapshotField(event) {
    setSnapshotForm(current => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function createProfile(event) {
    event.preventDefault()
    setSavingProfile(true)
    try {
      const result = await apiFetch('/api/competitors', { method: 'POST', body: JSON.stringify({ ...profileForm, publicProfile: true }) })
      setProfileForm(emptyProfileForm())
      await load(result.id)
      notify('Perfil público adicionado ao benchmark.')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function saveSnapshot(event) {
    event.preventDefault()
    if (!selectedProfile) return
    setSavingSnapshot(true)
    try {
      await apiFetch(`/api/competitors/${selectedProfile.id}/snapshots`, { method: 'POST', body: JSON.stringify(snapshotForm) })
      setSnapshotForm(emptySnapshotForm())
      setHistory(null)
      await load(selectedProfile.id)
      notify('Snapshot público salvo.')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setSavingSnapshot(false)
    }
  }

  async function showHistory(profile) {
    if (history?.profileId === profile.id) { setHistory(null); return }
    try {
      const result = await apiFetch(`/api/competitors/${profile.id}/snapshots`)
      setHistory({ profileId: profile.id, snapshots: result.snapshots || [] })
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function removeProfile(profile) {
    if (!window.confirm(`Remover ${profile.name} do benchmarking? O histórico público também será removido.`)) return
    try {
      await apiFetch(`/api/competitors/${profile.id}`, { method: 'DELETE' })
      if (selectedId === profile.id) setSelectedId(null)
      setHistory(null)
      await load()
      notify('Perfil removido.')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  async function toggleMonitor(profile) {
    setMonitorBusyId(profile.id)
    const enabled = !profile.monitor?.enabled
    try {
      await apiFetch(`/api/competitors/${profile.id}/monitor`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled, provider: 'auto', intervalMinutes: profile.monitor?.intervalMinutes || 15 })
      })
      await load(profile.id)
      notify(enabled ? 'Observação automática ativada.' : 'Observação automática pausada.')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setMonitorBusyId(null)
    }
  }

  return <section className="page-view benchmarking-page">
    <header className="benchmarking-hero">
      <div>
        <p className="eyebrow">DADOS ABERTOS · BENCHMARKING</p>
        <h2>Compare referências por nicho</h2>
        <p>Organize perfis públicos de diferentes redes, acompanhe snapshots e encontre padrões de conteúdo para a sua estratégia.</p>
      </div>
      <div className="benchmarking-public-badge"><span aria-hidden="true">◉</span><div><strong>Somente perfis públicos</strong><small>Sem login, invasão ou dados privados</small></div></div>
    </header>

    <section className="benchmark-summary-grid" aria-label="Resumo do benchmarking">
      <Metric label="Perfis acompanhados" value={loading ? '—' : fmtNumber(data.summary.profiles)} hint="redes diferentes" />
      <Metric label="Nichos" value={loading ? '—' : fmtNumber(data.summary.niches)} hint="grupos comparáveis" />
      <Metric label="Seguidores somados" value={loading ? '—' : fmtNumber(data.summary.totalFollowers)} hint="últimos snapshots" />
      <Metric label="Engajamento médio" value={loading ? '—' : fmtPercent(data.summary.averageEngagementRate)} hint="interações ÷ seguidores" />
    </section>

    <div className="benchmarking-layout">
      <section className="panel benchmark-form-panel">
        <div className="benchmark-section-heading"><div><p className="eyebrow">01 · NOVA REFERÊNCIA</p><h3>Adicionar perfil público</h3></div><span className="benchmark-lock">Público</span></div>
        <p className="benchmark-help">Cadastre o endereço público do perfil. A URL é validada para evitar fontes fora da rede escolhida.</p>
        <form className="benchmark-form" onSubmit={createProfile}>
          <label>Nome de referência<input name="name" value={profileForm.name} onChange={updateProfileField} placeholder="Ex.: Studio Aurora" required /></label>
          <label>Rede<select name="platform" value={profileForm.platform} onChange={updateProfileField}>{PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Identificador<input name="handle" value={profileForm.handle} onChange={updateProfileField} placeholder="@perfil" required /></label>
          <label>Nicho<input name="niche" value={profileForm.niche} onChange={updateProfileField} placeholder="Ex.: beleza, fitness, educação" required /></label>
          <label className="benchmark-form-wide">URL pública do perfil<input type="url" name="profileUrl" value={profileForm.profileUrl} onChange={updateProfileField} placeholder="https://www.instagram.com/perfil" required /></label>
          <button className="action-button benchmark-submit" disabled={savingProfile}>{savingProfile ? 'Adicionando...' : 'Adicionar perfil'}</button>
        </form>
        <p className="benchmark-privacy-note">Use apenas informações visíveis para qualquer pessoa. Para coleta automática, conecte no futuro uma API oficial autorizada; o sistema não contorna bloqueios da plataforma.</p>
      </section>

      <section className="panel benchmark-form-panel">
        <div className="benchmark-section-heading"><div><p className="eyebrow">02 · COLETA PÚBLICA</p><h3>Registrar snapshot</h3></div><span className="benchmark-lock">{selectedProfile ? PLATFORM_LABELS[selectedProfile.platform] : 'Selecione um perfil'}</span></div>
        {selectedProfile ? <>
          <p className="benchmark-help">Informe as médias dos últimos conteúdos públicos observados em <strong>{selectedProfile.name}</strong>. Repetir a data atualiza a coleta.</p>
          <form className="benchmark-form snapshot-form" onSubmit={saveSnapshot}>
            <label>Perfil<select value={selectedId || ''} onChange={event => { setSelectedId(Number(event.target.value)); setHistory(null) }}>{data.competitors.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.niche}</option>)}</select></label>
            <label>Data da coleta<input type="date" name="capturedOn" value={snapshotForm.capturedOn} onChange={updateSnapshotField} required /></label>
            <label>Seguidores<input type="number" min="0" name="followers" value={snapshotForm.followers} onChange={updateSnapshotField} placeholder="0" required /></label>
            <label>Posts em 30 dias<input type="number" min="0" name="postsLast30Days" value={snapshotForm.postsLast30Days} onChange={updateSnapshotField} placeholder="0" required /></label>
            <label>Média de curtidas<input type="number" min="0" step="0.01" name="avgLikes" value={snapshotForm.avgLikes} onChange={updateSnapshotField} placeholder="0" /></label>
            <label>Média de comentários<input type="number" min="0" step="0.01" name="avgComments" value={snapshotForm.avgComments} onChange={updateSnapshotField} placeholder="0" /></label>
            <label>Média de compartilhamentos<input type="number" min="0" step="0.01" name="avgShares" value={snapshotForm.avgShares} onChange={updateSnapshotField} placeholder="0" /></label>
            <label>Média de visualizações<input type="number" min="0" step="0.01" name="avgViews" value={snapshotForm.avgViews} onChange={updateSnapshotField} placeholder="0" /></label>
            <label>Média de salvamentos<input type="number" min="0" step="0.01" name="avgSaves" value={snapshotForm.avgSaves} onChange={updateSnapshotField} placeholder="0" /></label>
            <label>Método<select name="collectionMethod" value={snapshotForm.collectionMethod} onChange={updateSnapshotField}><option value="manual">Observação manual</option><option value="official_api">API oficial autorizada</option></select></label>
            <label className="benchmark-form-wide">Fonte pública da coleta (opcional)<input type="url" name="sourceUrl" value={snapshotForm.sourceUrl} onChange={updateSnapshotField} placeholder={selectedProfile.profileUrl} /></label>
            <button className="action-button benchmark-submit" disabled={savingSnapshot}>{savingSnapshot ? 'Salvando...' : 'Salvar snapshot'}</button>
          </form>
        </> : <div className="benchmark-empty-inline"><span>＋</span><p>Adicione ou selecione um perfil para registrar a primeira coleta.</p></div>}
      </section>
    </div>

    <section className="panel benchmark-results-panel">
      <div className="benchmark-results-heading"><div><p className="eyebrow">03 · LEITURA COMPARATIVA</p><h3>Ranking por engajamento</h3><p>Perfis com snapshot aparecem ordenados pelo mesmo indicador, independentemente da rede.</p></div><label className="benchmark-filter">Filtrar por nicho<select value={nicheFilter} onChange={event => setNicheFilter(event.target.value)}><option value="all">Todos os nichos</option>{niches.map(niche => <option key={niche} value={niche}>{niche}</option>)}</select></label></div>
      {loading ? <p className="empty-state">Carregando referências...</p> : visibleProfiles.length ? <div className="benchmark-profile-list">{visibleProfiles.map((profile, index) => {
        const snapshot = profile.latestSnapshot
        const isHistoryOpen = history?.profileId === profile.id
        return <div className="benchmark-profile-wrap" key={profile.id}>
          <article className={`benchmark-profile-card${selectedId === profile.id ? ' is-selected' : ''}`}>
            <button type="button" className="benchmark-profile-main" onClick={() => { setSelectedId(profile.id); setHistory(null) }}>
              <span className="benchmark-rank">{snapshot ? `#${index + 1}` : '—'}</span><span className={platformClass(profile.platform)}>{profile.platform.slice(0, 1).toUpperCase()}</span><span className="benchmark-profile-copy"><strong>{profile.name}</strong><small>@{profile.handle} · {profile.niche} · <i className={`benchmark-monitor-dot benchmark-monitor-${profile.monitor?.status || 'idle'}`} />{monitorLabel(profile.monitor)}</small></span>
            </button>
            <div className="benchmark-profile-stats">{snapshot ? <><Metric label="Engajamento" value={fmtPercent(snapshot.engagementRate)} /><Metric label="Seguidores" value={fmtNumber(snapshot.followers)} /><Metric label="Posts / 30d" value={fmtNumber(snapshot.postsLast30Days)} /></> : <span className="benchmark-no-snapshot">Sem snapshot ainda</span>}</div>
            <div className="benchmark-profile-actions"><a href={profile.profileUrl} target="_blank" rel="noreferrer" className="link-button">Abrir perfil</a><button type="button" className="link-button" onClick={() => showHistory(profile)}>{isHistoryOpen ? 'Fechar histórico' : 'Histórico'}</button><button type="button" className="link-button benchmark-monitor-action" onClick={() => toggleMonitor(profile)} disabled={monitorBusyId === profile.id}>{monitorBusyId === profile.id ? 'Aguarde...' : profile.monitor?.enabled ? 'Pausar automático' : 'Ativar automático'}</button><button type="button" className="link-button danger-link" onClick={() => removeProfile(profile)} aria-label={`Remover ${profile.name}`}>Remover</button></div>
          </article>
          {profile.monitor?.error && <p className="benchmark-monitor-error">{profile.monitor.error}</p>}
          {isHistoryOpen && <div className="benchmark-history"><strong>Histórico de {profile.name}</strong>{history.snapshots.length ? <div className="benchmark-history-list">{history.snapshots.map(item => <span key={item.id}><b>{new Date(`${item.capturedOn}T00:00:00`).toLocaleDateString('pt-BR')}</b><em>{fmtPercent(item.engagementRate)}</em><small>{fmtNumber(item.followers)} seguidores · {item.collectionMethod === 'official_api' ? 'API oficial' : 'manual'}</small></span>)}</div> : <p>Nenhuma coleta registrada.</p>}</div>}
        </div>
      })}</div> : <div className="benchmark-empty-results"><span>◎</span><div><h4>Nenhum perfil neste recorte</h4><p>Adicione uma referência pública e registre um snapshot para começar a comparar.</p></div></div>}
    </section>
  </section>
}
