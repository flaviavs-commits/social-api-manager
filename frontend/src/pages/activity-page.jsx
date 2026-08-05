import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { useApiResource } from '../hooks/use-api-resource.js'
import { LoadingState } from '../components/ui/loading-state.jsx'
import { useToast } from '../components/ui/toast.jsx'

const TYPE_LABELS = { err: 'Erros', ok: 'Sucesso', info: 'Informações' }

export function ActivityPage() {
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  const load = useCallback(() => apiFetch('/api/logs?limit=200').then(data => data.logs || []), [])
  const { value: logs, loading, error, setError, reload } = useApiResource(load, [])
  const notify = useToast()

  const visibleLogs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return logs.filter(log => (type === 'all' || log.type === type) && (!query || `${log.message} ${log.platform || ''}`.toLowerCase().includes(query)))
  }, [logs, search, type])

  async function clearHistory() {
    if (!window.confirm('Limpar todo o histórico de atividades da sua conta?')) return
    try { await apiFetch('/api/logs', { method: 'DELETE' }); await reload(); notify('Histórico limpo.') }
    catch (caught) { setError(caught.message); notify(caught.message, 'error') }
  }

  return <section className="page-view activity-page"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">HISTÓRICO</p><h2>Central de atividades</h2><p className="panel-subtitle">Acompanhe publicações, conexões, renovações e falhas recentes.</p></div><div className="activity-heading-actions"><button type="button" className="secondary-button" onClick={() => reload().catch(() => {})}>Atualizar</button><button type="button" className="link-button danger-link" onClick={clearHistory} disabled={!logs.length}>Limpar histórico</button></div></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="activity-toolbar"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar atividade..." aria-label="Buscar atividade"/><select value={type} onChange={event => setType(event.target.value)} aria-label="Filtrar tipo de atividade"><option value="all">Todos os tipos</option>{Object.entries(TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    {loading ? <LoadingState>Carregando histórico...</LoadingState> : visibleLogs.length ? <div className="activity-list">{visibleLogs.map(log => <article className={`activity-item activity-item-${log.type || 'info'}`} key={log.id}><span className="activity-mark" aria-hidden="true">{log.type === 'err' ? '!' : log.type === 'ok' ? '✓' : 'i'}</span><div className="activity-copy"><strong>{log.message}</strong><small>{log.platform ? `${log.platform} · ` : ''}{log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : 'Agora'}</small></div><span className="activity-type">{TYPE_LABELS[log.type] || 'Atividade'}</span></article>)}</div> : <div className="activity-empty"><span aria-hidden="true">◌</span><p>{search || type !== 'all' ? 'Nenhuma atividade corresponde aos filtros.' : 'Nenhuma atividade registrada ainda.'}</p>{(search || type !== 'all') && <button className="link-button" onClick={() => { setSearch(''); setType('all') }}>Limpar filtros</button>}</div>}
  </section></section>
}
