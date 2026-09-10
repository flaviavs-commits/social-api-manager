import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// A partir do Node 25, o runtime passou a definir um `localStorage`/
// `sessionStorage` global próprios (API nativa de Web Storage), mas sem
// backing file eles ficam com os métodos undefined (`getItem`/`setItem`/
// `clear`). O populateGlobal do Vitest só substitui uma chave global por sua
// versão do jsdom quando ela ainda não existe no ambiente Node — como o Node
// já define `localStorage`, o Vitest pula a substituição e o global quebrado
// do Node vence, mesmo com `environment: 'jsdom'` configurado.
// Fix: sobrescrever explicitamente pelo localStorage/sessionStorage reais do
// jsdom que o Vitest já instancia (exposto em `globalThis.jsdom.window`),
// repetindo a cada teste para isolar o estado entre eles como o
// comportamento anterior de localStorage.clear() em beforeEach já pressupõe.
function restaurarWebStorageDoJsdom() {
  const jsdomWindow = globalThis.jsdom?.window
  if (!jsdomWindow) return
  for (const chave of ['localStorage', 'sessionStorage']) {
    if (typeof globalThis[chave]?.getItem === 'function') continue
    Object.defineProperty(globalThis, chave, {
      value: jsdomWindow[chave],
      configurable: true,
      writable: true,
    })
  }
}

restaurarWebStorageDoJsdom()
beforeEach(restaurarWebStorageDoJsdom)
