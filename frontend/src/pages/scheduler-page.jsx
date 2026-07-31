import { useState } from 'react'
import { apiFetch } from '../lib/api.js'

const platforms = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'threads', 'pinterest']

export function SchedulerPage() {
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [publishNow, setPublishNow] = useState(false)
  const [selected, setSelected] = useState(['instagram'])
  const [files, setFiles] = useState([])
  const [youtubeTitle, setYoutubeTitle] = useState('')
  const [youtubeVisibility, setYoutubeVisibility] = useState('public')
  const [igFormat, setIgFormat] = useState('feed')
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('PUBLIC_TO_EVERYONE')
  const [firstComment, setFirstComment] = useState('')
  const [textByPlatform, setTextByPlatform] = useState({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  function toggle(platform) { setSelected(value => value.includes(platform) ? value.filter(item => item !== platform) : [...value, platform]) }
  function selectFiles(event) { setFiles(Array.from(event.target.files || [])) }

  async function uploadFile(file) {
    const data = await apiFetch('/api/posts/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, mimetype: file.type }) })
    const response = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!response.ok) throw new Error(`Falha ao enviar ${file.name}`)
    return { path: data.uploadUrl.split('?')[0], type: file.type, name: file.name }
  }

  async function submit(event) {
    event.preventDefault(); setLoading(true); setError(''); setSaved(false)
    try {
      const media = await Promise.all(files.map(uploadFile))
      const scheduledAt = publishNow ? new Date().toISOString() : date
      await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ text, scheduledAt, platforms: JSON.stringify(selected), publishNow, media: JSON.stringify(media), youtubeTitle, youtubeVisibility, igFormat, tiktokPrivacyLevel, firstComment, textByPlatform: JSON.stringify(textByPlatform) }) })
      setText(''); setDate(''); setFiles([]); setYoutubeTitle(''); setFirstComment(''); setTextByPlatform({}); setPublishNow(false); setSaved(true)
    } catch (caught) { setError(caught.message) } finally { setLoading(false) }
  }

  return <section className="page-view"><section className="panel"><p className="eyebrow">PUBLICAÇÃO</p><h2>{publishNow ? 'Publicar agora' : 'Agendar publicação'}</h2><form className="draft-form" onSubmit={submit}><textarea required value={text} onChange={event => setText(event.target.value)} maxLength={5000} placeholder="Escreva o texto da publicação..." aria-label="Texto da publicação"/><label className="mode-toggle"><input type="checkbox" checked={publishNow} onChange={event => setPublishNow(event.target.checked)}/> Publicar imediatamente</label>{!publishNow && <label>Data e hora<input required type="datetime-local" value={date} onChange={event => setDate(event.target.value)}/></label>}<label className="upload-field">Mídias<input type="file" multiple accept="image/*,video/*" onChange={selectFiles}/></label>{files.length > 0 && <div className="media-preview" aria-label="Arquivos selecionados">{files.map(file => <span key={`${file.name}-${file.lastModified}`}>{file.name}</span>)}</div>}<fieldset><legend>Plataformas</legend><div className="platform-options">{platforms.map(platform => <label key={platform}><input type="checkbox" checked={selected.includes(platform)} onChange={() => toggle(platform)}/>{platform}</label>)}</div></fieldset><fieldset><legend>Opções por plataforma</legend><div className="advanced-options"><label>Título do YouTube<input value={youtubeTitle} onChange={event => setYoutubeTitle(event.target.value)} maxLength={100}/></label><label>Visibilidade<select value={youtubeVisibility} onChange={event => setYoutubeVisibility(event.target.value)}><option value="public">Público</option><option value="unlisted">Não listado</option><option value="private">Privado</option></select></label><label>Formato Instagram<select value={igFormat} onChange={event => setIgFormat(event.target.value)}><option value="feed">Feed</option><option value="reel">Reel</option><option value="story">Story</option></select></label><label>Privacidade TikTok<select value={tiktokPrivacyLevel} onChange={event => setTiktokPrivacyLevel(event.target.value)}><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="SELF_ONLY">Somente eu</option></select></label><label>Primeiro comentário<textarea value={firstComment} onChange={event => setFirstComment(event.target.value)} maxLength={2000}/></label></div></fieldset><fieldset><legend>Texto específico por rede (opcional)</legend><div className="advanced-options">{selected.map(platform => <label key={platform}>{platform}<textarea value={textByPlatform[platform] || ''} onChange={event => setTextByPlatform(value => ({ ...value, [platform]: event.target.value }))} maxLength={5000}/></label>)}</div></fieldset><button className="action-button" disabled={loading}>{loading ? 'Enviando...' : publishNow ? 'Publicar agora' : 'Agendar'}</button></form>{saved && <p className="success-message">{publishNow ? 'Publicação enviada.' : 'Publicação agendada.'}</p>}{error && <p className="error-message">{error}</p>}</section></section>
}
