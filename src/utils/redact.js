const SENSITIVE_KEY = /access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|authorization|password|reset[_-]?token|code[_-]?verifier|(^|[_-])token($|[_-])|(^|[_-])secret($|[_-])/i

function redact(value, depth = 0) {
  if (depth > 6) return '[redacted]'
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)
    ]))
  }
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
      .replace(/((?:access|refresh|id)[_-]?token|client[_-]?secret|api[_-]?key|password|token|secret)=([^&\s]+)/gi, '$1=[redacted]')
  }
  return value
}

function safeStringify(value) {
  try { return JSON.stringify(redact(value)) } catch { return '[unserializable]' }
}

function safeMessage(value) {
  return redact(String(value || ''))
}

module.exports = { redact, safeStringify, safeMessage }
