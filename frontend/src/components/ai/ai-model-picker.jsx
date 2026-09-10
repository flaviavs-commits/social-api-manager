import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api.js'

const FALLBACK_MODELS = [
  { id: 'openrouter', name: 'GPT-4o Mini', provider: 'OpenRouter', available: false },
  { id: 'gemini', name: 'Gemini 2.0 Flash', provider: 'Google', available: false },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google', available: false },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google', available: false },
  { id: 'gemini-2.5-lite', name: 'Gemini Flash-Lite', provider: 'Google', available: false },
  { id: 'openai', name: 'GPT-4o Mini', provider: 'OpenAI', available: false },
  { id: 'openai-4o', name: 'GPT-4o', provider: 'OpenAI', available: false },
  { id: 'claude', name: 'Claude Haiku', provider: 'Anthropic', available: false },
  { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'Anthropic', available: false },
]
const VISION_MODELS = new Set(['gemini', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-lite', 'openai', 'openai-4o', 'openrouter', 'claude', 'claude-sonnet'])
const NON_TEXT_MODELS = new Set(['openrouter-image'])

function visibleModelLabel(model) {
  const name = String(model.name || '').replace(/\s*\(OpenRouter\)/gi, '').trim()
  const provider = String(model.provider || '').trim()
  return provider && !/^openrouter$/i.test(provider) ? `${name} · ${provider}` : name
}

export function AiModelPicker({ value, onChange, compact = false, visionOnly = false }) {
  const [models, setModels] = useState(FALLBACK_MODELS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([
      apiFetch('/api/ai/models'),
      apiFetch('/api/ai/prefs'),
    ]).then(([modelData, preferenceData]) => {
      if (!active) return
      if (Array.isArray(modelData.models) && modelData.models.length) setModels(modelData.models)
      const preferred = preferenceData.preferred_model
      const allowedPreference = visionOnly
        ? VISION_MODELS.has(preferred)
        : !NON_TEXT_MODELS.has(preferred)
      if (preferred && allowedPreference && typeof onChange === 'function') onChange(preferred)
      if (preferred && !allowedPreference && !visionOnly && modelData.models?.some(model => model.id === 'openrouter') && typeof onChange === 'function') onChange('openrouter')
    }).catch(() => {}).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onChange])

  async function changeModel(event) {
    const model = event.target.value
    onChange?.(model)
    try {
      await apiFetch('/api/ai/prefs', { method: 'PUT', body: JSON.stringify({ modelo: model }) })
    } catch {
      // A escolha local continua válida mesmo se a preferência não puder ser salva.
    }
  }

  const visibleModels = models.filter(model => {
    if (NON_TEXT_MODELS.has(model.id)) return false
    return !visionOnly || VISION_MODELS.has(model.id)
  })
  const selectedValue = visibleModels.some(model => model.id === value) ? value : (visibleModels[0]?.id || value || 'openrouter')

  return <label className={`ai-model-picker${compact ? ' ai-model-picker-compact' : ''}`}>
    <span>{compact ? 'Modelo' : 'Escolha o modelo do sistema'}</span>
    <select value={selectedValue} onChange={changeModel} disabled={loading} aria-label="Modelo do sistema">
      {visibleModels.map(model => <option key={model.id} value={model.id}>
        {visibleModelLabel(model)}{model.available ? '' : ' · configure sua chave'}
      </option>)}
    </select>
    {!compact && <small>Você pode trocar o modelo a qualquer momento. Para provedores externos, configure sua chave de API.</small>}
  </label>
}
