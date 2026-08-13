// Estado do tutorial guiado, persistido no navegador do usuário.
//
// - "seen": o tutorial já apareceu automaticamente para esta pessoa (não deve
//   surgir sozinho de novo, mesmo que ela não tenha concluído).
// - "completed": a pessoa percorreu todos os passos até o fim. É essa flag
//   que confirma "o usuário completou o tutorial" e pode ser consultada por
//   qualquer tela (ex.: cartão no Perfil).
//
// O tutorial continua disponível manualmente a qualquer momento (botão no
// topo do app ou no Perfil), independentemente do status salvo aqui.

const STORAGE_KEY = 'meu-ecoo:tutorial-status'
export const TUTORIAL_OPEN_EVENT = 'meu-ecoo:open-tutorial'
export const TUTORIAL_STATUS_EVENT = 'meu-ecoo:tutorial-status-changed'

const DEFAULT_STATUS = { seen: false, completed: false, completedAt: null }

export function getTutorialStatus() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATUS }
    return { ...DEFAULT_STATUS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_STATUS }
  }
}

function saveStatus(status) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(status))
  window.dispatchEvent(new CustomEvent(TUTORIAL_STATUS_EVENT, { detail: status }))
  return status
}

export function markTutorialSeen() {
  const current = getTutorialStatus()
  if (current.seen) return current
  return saveStatus({ ...current, seen: true })
}

export function markTutorialCompleted() {
  return saveStatus({ seen: true, completed: true, completedAt: new Date().toISOString() })
}

export function resetTutorialStatus() {
  return saveStatus({ ...DEFAULT_STATUS })
}

// Dispara a abertura do tutorial a partir de qualquer parte do app (ex.:
// botão "Rever tutorial" no Perfil), sem precisar repassar estado via props.
export function requestTutorialOpen() {
  window.dispatchEvent(new CustomEvent(TUTORIAL_OPEN_EVENT))
}
