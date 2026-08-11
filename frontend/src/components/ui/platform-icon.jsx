const paths = {
  instagram: { viewBox: '0 0 24 24', color: '#E1306C', d: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm10 2H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3Zm-5 3.4A4.6 4.6 0 1 1 7.4 12 4.6 4.6 0 0 1 12 7.4Zm0 2A2.6 2.6 0 1 0 14.6 12 2.6 2.6 0 0 0 12 9.4Zm4.9-3.65a1.1 1.1 0 1 1-1.1 1.1 1.1 1.1 0 0 1 1.1-1.1Z' },
  facebook: { viewBox: '0 0 24 24', color: '#1877F2', d: 'M13.5 21v-7.2h2.4l.36-2.8h-2.76V9.2c0-.81.22-1.36 1.39-1.36h1.48V5.34A19.8 19.8 0 0 0 14.2 5.2c-2.13 0-3.6 1.3-3.6 3.68v2.12H8.2v2.8h2.4V21h2.9Z' },
  youtube: { viewBox: '0 0 24 24', color: '#FF0000', d: 'M21.58 7.19a2.51 2.51 0 0 0-1.77-1.78C18.25 5 12 5 12 5s-6.25 0-7.81.41a2.51 2.51 0 0 0-1.77 1.78A26.3 26.3 0 0 0 2 12a26.3 26.3 0 0 0 .42 4.81 2.51 2.51 0 0 0 1.77 1.78C5.75 19 12 19 12 19s6.25 0 7.81-.41a2.51 2.51 0 0 0 1.77-1.78A26.3 26.3 0 0 0 22 12a26.3 26.3 0 0 0-.42-4.81ZM10 15.5v-7l6 3.5Z' },
  tiktok: { viewBox: '0 0 24 24', color: '#E5B842', d: 'M14.5 3h2.4c.16 1.4.9 2.98 2.6 3.68.7.3 1.5.44 2.5.44v2.5c-1.5 0-2.9-.4-4.1-1.16v6.16a5.98 5.98 0 1 1-6-6c.2 0 .4 0 .6.03v2.55a3.4 3.4 0 1 0 2.4 3.25V3Z' },
  x: { viewBox: '0 0 24 24', color: '#E7E9EA', d: 'M4 3h4.2l4 5.6L16.6 3H20l-6.2 8.1L20.4 21h-4.2l-4.3-6-5 6H3l6.6-8.4L4 3Z' }
}

export function PlatformIcon({ platform, className = 'h-3.5 w-3.5' }) {
  const key = (platform || '').toLowerCase()
  const icon = paths[key]
  if (!icon) return null
  return (
    <svg viewBox={icon.viewBox} className={className} fill={icon.color} aria-hidden="true">
      <path d={icon.d} />
    </svg>
  )
}
