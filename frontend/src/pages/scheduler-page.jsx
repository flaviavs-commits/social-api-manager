import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { buildValidationIssues, mediaFileKey, readVideoMeta } from '../lib/postValidation.js'
import { SchedSection } from '../components/ui/sched-section.jsx'

const platforms = ['instagram', 'facebook', 'youtube', 'tiktok']

// Categorias da YouTube Data API v3 — espelha src/domain/posts/post.js
// (YOUTUBE_CATEGORIES), fonte da verdade no backend.
const youtubeCategories = [
  { id: '1', label: 'Filmes e animação' },
  { id: '2', label: 'Carros e veículos' },
  { id: '10', label: 'Música' },
  { id: '15', label: 'Animais' },
  { id: '17', label: 'Esportes' },
  { id: '19', label: 'Viagens e eventos' },
  { id: '20', label: 'Games' },
  { id: '22', label: 'Pessoas e blogs' },
  { id: '23', label: 'Comédia' },
  { id: '24', label: 'Entretenimento' },
  { id: '25', label: 'Notícias e política' },
  { id: '26', label: 'Como fazer e estilo' },
  { id: '27', label: 'Educação' },
  { id: '28', label: 'Ciência e tecnologia' },
]

export function SchedulerPage() {
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [selected, setSelected] = useState(['instagram'])
  const [files, setFiles] = useState([])
  const [videoMetaByKey, setVideoMetaByKey] = useState({})
  const [youtubeTitle, setYoutubeTitle] = useState('')
  const [youtubeVisibility, setYoutubeVisibility] = useState('public')
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState('')
  const [igFormat, setIgFormat] = useState('post')
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('PUBLIC_TO_EVERYONE')
  const [tiktokDisableComment, setTiktokDisableComment] = useState(false)
  const [tiktokDisableDuet, setTiktokDisableDuet] = useState(false)
  const [tiktokDisableStitch, setTiktokDisableStitch] = useState(false)
  const [youtubeCategoryId, setYoutubeCategoryId] = useState('')
  const [youtubeFormat, setYoutubeFormat] = useState('')
  const [firstComment, setFirstComment] = useState('')
  const [textByPlatform, setTextByPlatform] = useState({})
  const [locationQuery, setLocationQuery] = useState('')
  const [locationResults, setLocationResults] = useState([])
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const locationSearchTimer = useRef(null)

  function toggle(platform) { setSelected(value => value.includes(platform) ? value.filter(item => item !== platform) : [...value, platform]) }
  function selectFiles(event) { setFiles(Array.from(event.target.files || [])) }

  // Lê metadados (largura/altura) dos vídeos selecionados para checar a
  // proporção exigida pelo TikTok antes do upload — ver postValidation.js.
  useEffect(() => {
    let cancelado = false
    const videos = files.filter(file => file.type.startsWith('video/'))
    Promise.all(videos.map(async file => [mediaFileKey(file), await readVideoMeta(file)])).then(pares => {
      if (cancelado) return
      setVideoMetaByKey(Object.fromEntries(pares.filter(([, meta]) => meta)))
    })
    return () => { cancelado = true }
  }, [files])

  const issues = buildValidationIssues({ text, platforms: selected, files, publishNow, scheduledAt: date, youtubeTitle, youtubeMadeForKids, igFormat, tiktokPrivacyLevel, videoMetaByKey })

  // Busca de local (Facebook/Instagram) com debounce, espelhando o
  // comportamento do app legado (public/app.html, onLocationSearchInput):
  // só busca com 3+ caracteres e cancela a busca anterior a cada tecla.
  useEffect(() => {
    clearTimeout(locationSearchTimer.current)
    if (locationQuery.trim().length < 3) { setLocationResults([]); return }
    locationSearchTimer.current = setTimeout(async () => {
      try {
        const { locations } = await apiFetch(`/api/posts/facebook-places?q=${encodeURIComponent(locationQuery.trim())}`)
        setLocationResults(locations || [])
      } catch { setLocationResults([]) }
    }, 400)
    return () => clearTimeout(locationSearchTimer.current)
  }, [locationQuery])

  function chooseLocation(location) {
    setSelectedLocation(location)
    setLocationQuery('')
    setLocationResults([])
  }

  async function uploadFile(file) {
    const data = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
    const response = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!response.ok) throw new Error(`Falha ao enviar ${file.name}`)
    return { path: data.uploadUrl.split('?')[0], type: file.type, name: file.name }
  }

  async function submit(event) {
    event.preventDefault(); setError(''); setSaved(false)
    if (issues.length > 0) { setError(issues[0].message); return }
    setLoading(true)
    try {
      const media = await Promise.all(files.map(uploadFile))
      const scheduledAt = publishNow ? new Date().toISOString() : date
      await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ text, scheduledAt, platforms: JSON.stringify(selected), publishNow, media: JSON.stringify(media), youtubeTitle, youtubeVisibility, youtubeMadeForKids: youtubeMadeForKids === '' ? undefined : youtubeMadeForKids === 'true', youtubeCategoryId: youtubeCategoryId || undefined, youtubeFormat: youtubeFormat || undefined, igFormat, tiktokPrivacyLevel, tiktokDisableComment, tiktokDisableDuet, tiktokDisableStitch, firstComment, textByPlatform: JSON.stringify(textByPlatform), locationId: selectedLocation?.id, locationName: selectedLocation?.name }) })
      setText(''); setDate(''); setFiles([]); setYoutubeTitle(''); setYoutubeMadeForKids(''); setYoutubeCategoryId(''); setYoutubeFormat(''); setTiktokDisableComment(false); setTiktokDisableDuet(false); setTiktokDisableStitch(false); setFirstComment(''); setTextByPlatform({}); setSelectedLocation(null); setLocationQuery(''); setPublishNow(false); setSaved(true)
    } catch (caught) { setError(caught.message) } finally { setLoading(false) }
  }

  return <section className="page-view"><section className="panel"><p className="eyebrow">PUBLICAÇÃO</p><h2>{publishNow ? 'Publicar agora' : 'Agendar publicação'}</h2><form className="draft-form sched-form" onSubmit={submit}>

    <SchedSection number={1} title="Plataformas">
      <div className="platform-options">{platforms.map(platform => <label key={platform}><input type="checkbox" checked={selected.includes(platform)} onChange={() => toggle(platform)}/>{platform}</label>)}</div>
    </SchedSection>

    <SchedSection number={2} title="Conteúdo">
      <label>Texto do post<textarea value={text} onChange={event => setText(event.target.value)} maxLength={5000} placeholder="Escreva o texto da publicação..." aria-label="Texto da publicação"/></label>
      <label className="upload-field">Mídias<input type="file" multiple accept="image/*,video/*" onChange={selectFiles}/></label>
      {files.length > 0 && <div className="media-preview" aria-label="Arquivos selecionados">{files.map(file => <span key={mediaFileKey(file)}>{file.name}</span>)}</div>}
      {selected.length > 1 && <div className="advanced-options" style={{ marginTop: 12 }}>{selected.map(platform => <label key={platform}>Texto para {platform} (opcional)<textarea value={textByPlatform[platform] || ''} onChange={event => setTextByPlatform(value => ({ ...value, [platform]: event.target.value }))} maxLength={5000}/></label>)}</div>}
    </SchedSection>

    <SchedSection number={3} title="Configurações por rede">
      <div className="advanced-options">
        {selected.includes('youtube') && <>
          <label>Título do YouTube<input value={youtubeTitle} onChange={event => setYoutubeTitle(event.target.value)} maxLength={100}/></label>
          <label>Visibilidade<select value={youtubeVisibility} onChange={event => setYoutubeVisibility(event.target.value)}><option value="public">Público</option><option value="unlisted">Não listado</option><option value="private">Privado</option></select></label>
          <label>Feito para crianças (YouTube)<select value={youtubeMadeForKids} onChange={event => setYoutubeMadeForKids(event.target.value)}><option value="">Selecione...</option><option value="false">Não</option><option value="true">Sim</option></select></label>
          <label>Categoria do YouTube<select value={youtubeCategoryId} onChange={event => setYoutubeCategoryId(event.target.value)}><option value="">Automática</option>{youtubeCategories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label>Formato do YouTube<select value={youtubeFormat} onChange={event => setYoutubeFormat(event.target.value)}><option value="">Automático</option><option value="video">Vídeo</option><option value="short">Short</option></select></label>
        </>}
        {selected.includes('instagram') && <label>Formato Instagram<select value={igFormat} onChange={event => setIgFormat(event.target.value)}><option value="post">Feed</option><option value="reel">Reel</option><option value="story">Story</option></select></label>}
        {selected.includes('tiktok') && <>
          <label>Privacidade TikTok<select value={tiktokPrivacyLevel} onChange={event => setTiktokPrivacyLevel(event.target.value)}><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="SELF_ONLY">Somente eu</option></select></label>
          <label>Interações do TikTok<span className="checkbox-row"><label><input type="checkbox" checked={tiktokDisableComment} onChange={event => setTiktokDisableComment(event.target.checked)}/> Bloquear comentários</label><label><input type="checkbox" checked={tiktokDisableDuet} onChange={event => setTiktokDisableDuet(event.target.checked)}/> Bloquear duet</label><label><input type="checkbox" checked={tiktokDisableStitch} onChange={event => setTiktokDisableStitch(event.target.checked)}/> Bloquear stitch</label></span></label>
        </>}
        {(selected.includes('facebook') || selected.includes('instagram')) && <label className="location-field">Local (Facebook/Instagram)<input value={locationQuery} onChange={event => setLocationQuery(event.target.value)} placeholder="Buscar local (ex: Av. Paulista, São Paulo)" autoComplete="off"/>{locationResults.length > 0 && <ul className="location-results">{locationResults.map(location => <li key={location.id}><button type="button" onClick={() => chooseLocation(location)}>{location.name}</button></li>)}</ul>}{selectedLocation && <p className="location-selected">{selectedLocation.name} <button type="button" onClick={() => setSelectedLocation(null)}>✕</button></p>}</label>}
        <label>Primeiro comentário<textarea value={firstComment} onChange={event => setFirstComment(event.target.value)} maxLength={2000}/></label>
        {selected.length === 0 && <p className="empty-state">Escolha ao menos uma rede acima para ver as opções específicas dela.</p>}
      </div>
    </SchedSection>

    <SchedSection number={4} title="Agendamento">
      <label className="mode-toggle"><input type="checkbox" checked={publishNow} onChange={event => setPublishNow(event.target.checked)}/> Publicar imediatamente</label>
      {!publishNow && <label>Data e hora<input required type="datetime-local" value={date} onChange={event => setDate(event.target.value)}/></label>}
    </SchedSection>

    {issues.length > 0 && <div className="validation-panel" aria-live="polite"><p className="validation-panel-heading">⚠ {issues.length} {issues.length === 1 ? 'pendência' : 'pendências'} antes de {publishNow ? 'publicar' : 'agendar'}</p><ul className="validation-panel-list">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div>}
    <button className="action-button" disabled={loading || issues.length > 0}>{loading ? 'Enviando...' : publishNow ? 'Publicar agora' : 'Agendar'}</button>
  </form>{saved && <p className="success-message">{publishNow ? 'Publicação enviada.' : 'Publicação agendada.'}</p>}{error && <p className="error-message">{error}</p>}</section></section>
}
