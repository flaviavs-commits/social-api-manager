// Ícones usados exclusivamente nas prévias realistas do agendador
// (frontend/src/pages/scheduler-page.jsx). Reproduzem, em traço simples, os
// glifos de interação de cada rede social (curtir, comentar, compartilhar…)
// para que o cartão de prévia se pareça com o app real sem depender de uma
// biblioteca de ícones externa.

const base = { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true }

export function HeartIcon({ filled = false, ...props }) {
  return <svg {...base} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 20.6s-6.9-4.2-9.5-8.3C.8 9.5 1.7 5.9 5 4.6c2.3-.9 4.6 0 7 2.5 2.4-2.5 4.7-3.4 7-2.5 3.3 1.3 4.2 4.9 2.5 7.7-2.6 4.1-9.5 8.3-9.5 8.3Z"/>
  </svg>
}

export function CommentIcon(props) {
  return <svg {...base} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 11.6a8.4 8.4 0 0 1-8.5 8.4c-1.3 0-2.6-.3-3.7-.9L3 21l1.9-5.6a8.3 8.3 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3a8.4 8.4 0 0 1 8.5 8.4Z"/>
  </svg>
}

export function ShareArrowIcon(props) {
  return <svg {...base} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M22 3 11 14M22 3 15 21l-4-7-7-4 18-7Z"/>
  </svg>
}

export function BookmarkIcon({ filled = false, ...props }) {
  return <svg {...base} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" {...props}>
    <path d="M6 3h12v18l-6-4.4L6 21V3Z"/>
  </svg>
}

export function ThumbsUpIcon(props) {
  return <svg {...base} fill="currentColor" {...props}>
    <path d="M2 21h3V10H2v11Zm19-10.3a2 2 0 0 0-2-2h-5.4l.8-3.9A1.6 1.6 0 0 0 12.9 3c-.4 0-.8.2-1.1.6L7 10v11h10.7a2 2 0 0 0 1.9-1.4l1.3-5.4c.06-.25.1-.5.1-.75v-.65Z"/>
  </svg>
}

export function GlobeIcon(props) {
  return <svg {...base} width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M3 12h18M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9Z"/>
  </svg>
}

export function MoreIcon(props) {
  return <svg {...base} width={16} height={16} fill="currentColor" {...props}>
    <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
  </svg>
}

export function MusicNoteIcon(props) {
  return <svg {...base} width={12} height={12} fill="currentColor" {...props}>
    <path d="M9 3v10.6A4 4 0 1 0 11 17V7.4h6V3H9Z"/>
  </svg>
}

export function PlayGlyphIcon(props) {
  return <svg {...base} fill="currentColor" {...props}>
    <path d="M8 5.3v13.4a1 1 0 0 0 1.53.85l10.7-6.7a1 1 0 0 0 0-1.7L9.53 4.45A1 1 0 0 0 8 5.3Z"/>
  </svg>
}

export function DislikeIcon(props) {
  return <svg {...base} fill="currentColor" {...props} style={{ transform: 'scaleY(-1)', ...(props.style || {}) }}>
    <path d="M2 21h3V10H2v11Zm19-10.3a2 2 0 0 0-2-2h-5.4l.8-3.9A1.6 1.6 0 0 0 12.9 3c-.4 0-.8.2-1.1.6L7 10v11h10.7a2 2 0 0 0 1.9-1.4l1.3-5.4c.06-.25.1-.5.1-.75v-.65Z"/>
  </svg>
}

export function RemixIcon(props) {
  return <svg {...base} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M17 2 21 6l-4 4M21 6H8a5 5 0 0 0-5 5v1M7 22 3 18l4-4M3 18h13a5 5 0 0 0 5-5v-1"/>
  </svg>
}

export function SendPlaneIcon(props) {
  return <svg {...base} fill="currentColor" {...props}>
    <path d="m3 11.5 17.7-8.4a.6.6 0 0 1 .84.7l-3.3 17.4a.6.6 0 0 1-1 .3l-5-4-2.6 2.5a.5.5 0 0 1-.85-.36v-3.9L3 11.5Z"/>
  </svg>
}
