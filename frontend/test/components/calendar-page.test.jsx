import { render, screen, waitFor } from '@testing-library/react'
import { CalendarPage } from '../../src/pages/calendar-page.jsx'
import { ToastProvider } from '../../src/components/ui/toast.jsx'
import * as api from '../../src/lib/api.js'

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-04T12:00:00-03:00'))
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function renderCalendar(posts = []) {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ posts })
    return render(<ToastProvider><CalendarPage onNavigate={vi.fn()} /></ToastProvider>)
  }

  it('keeps create and schedule actions available on a day that already has a post', async () => {
    const onNavigate = vi.fn()
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ posts: [{
      id: 1,
      text: 'Post publicado',
      platforms: ['instagram'],
      status: 'published',
      publishedAt: '2026-09-05T09:00:00-03:00'
    }] })

    render(<ToastProvider><CalendarPage onNavigate={onNavigate} /></ToastProvider>)

    const day = await screen.findByRole('button', { name: 'Abrir publicações de 5 de Setembro de 2026' })
    day.click()

    expect(await screen.findByRole('button', { name: 'Criar post' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agendar post' })).toBeInTheDocument()

    screen.getByRole('button', { name: 'Agendar post' }).click()

    expect(onNavigate).toHaveBeenCalledWith('agendador')
    expect(JSON.parse(localStorage.getItem('meu-ecoo:scheduler-autosave'))).toMatchObject({
      date: expect.stringMatching(/^2026-09-05T10:00/),
      publishNow: false
    })
  })

  it('keeps the actions available when the selected day is empty', async () => {
    renderCalendar()

    const day = await screen.findByRole('button', { name: 'Abrir publicações de 6 de Setembro de 2026' })
    day.click()

    await waitFor(() => expect(screen.getByText('Nenhuma publicação neste dia.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Criar post' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agendar post' })).toBeInTheDocument()
  })
})
