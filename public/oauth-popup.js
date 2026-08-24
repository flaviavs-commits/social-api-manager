(() => {
  const script = document.currentScript
  const targetUrl = script?.dataset.targetUrl
  const profileUrl = script?.dataset.profileUrl
  const status = document.getElementById('oauth-popup-status')
  const closeButton = document.getElementById('oauth-popup-close')

  const showCloseFallback = () => {
    if (window.closed) return
    if (status) status.textContent = 'A conexão foi processada. Você pode fechar esta janela.'
    if (closeButton) {
      closeButton.hidden = false
      closeButton.addEventListener('click', () => window.close(), { once: true })
    }
  }

  const closePopup = () => {
    try { window.close() } catch {}
    window.setTimeout(showCloseFallback, 250)
  }

  if (!targetUrl) {
    showCloseFallback()
    return
  }

  try {
    if (window.opener && !window.opener.closed) {
      window.opener.location.replace(targetUrl)
      if (profileUrl) window.open(profileUrl, '_blank', 'noopener,noreferrer')
      closePopup()
    } else {
      window.location.replace(targetUrl)
    }
  } catch {
    window.location.replace(targetUrl)
  }
})()
