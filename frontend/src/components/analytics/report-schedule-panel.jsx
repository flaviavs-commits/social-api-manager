import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { useToast } from '../ui/toast.jsx'

export function ReportSchedulePanel() {
  const [schedules, setSchedules] = useState([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: 'Relatório mensal', email: '', frequency: 'monthly' })
  const notify = useToast()
  const load = useCallback(() => apiFetch('/api/report-schedules').then(data => setSchedules(data.schedules || [])), [])

  useEffect(() => { load().catch(() => {}) }, [load])

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await apiFetch('/api/report-schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          recipients: form.email.split(',').map(item => item.trim()).filter(Boolean),
          frequency: form.frequency
        })
      })
      setForm(current => ({ ...current, email: '' }))
      await load()
      notify('Relatório enviado para seu e-mail. Agendamento salvo.')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    try {
      await apiFetch(`/api/report-schedules/${id}`, { method: 'DELETE' })
      setSchedules(current => current.filter(item => item.id !== id))
      notify('Agendamento removido.')
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  return <section className="panel mt-5">
    <div className="panel-heading"><div>
      <p className="eyebrow">AUTOMAÇÃO</p>
      <h3>Relatórios por e-mail</h3>
      <p className="panel-subtitle">Ao agendar, o sistema gera e envia o PDF completo agora e mantém os próximos envios no ciclo escolhido.</p>
    </div></div>
    <form className="grid gap-3 md:grid-cols-5" onSubmit={save}>
      <input aria-label="Nome do relatório" className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Nome do relatório" required />
      <input aria-label="E-mails do relatório" className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100 md:col-span-2" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} placeholder="E-mails separados por vírgula" required />
      <select aria-label="Frequência do relatório" className="rounded-lg border border-subtle bg-app px-3 py-2 text-sm text-zinc-100" value={form.frequency} onChange={event => setForm(current => ({ ...current, frequency: event.target.value }))}>
        <option value="monthly">Mensal</option>
        <option value="weekly">Semanal</option>
      </select>
      <button type="submit" className="action-button" disabled={saving}>Agendar</button>
    </form>
    {schedules.length > 0 && <div className="mt-4 space-y-2">{schedules.map(schedule => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-subtle bg-app px-3 py-2 text-sm" key={schedule.id}>
      <span><strong>{schedule.name}</strong><small className="ml-2 text-zinc-500">{schedule.frequency === 'weekly' ? 'Semanal' : 'Mensal'} · próximo {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleDateString('pt-BR') : '—'}{schedule.lastSentAt ? ` · último envio ${new Date(schedule.lastSentAt).toLocaleDateString('pt-BR')}` : ''}</small></span>
      <button type="button" className="link-button danger-link" onClick={() => remove(schedule.id)}>Remover</button>
    </div>)}</div>}
  </section>
}
