const RESTRICTIONS = [
  {
    id: 'adult',
    pattern: /\b(?:conte[uú]do adulto|sexo|sexual|porn[oô]|er[oó]tic|nude|nudes|xxx|prostitui[cç]|fetiche|onlyfans)\b|\+18/i,
    message: 'A IA não está autorizada a criar conteúdo adulto, sexual ou +18.'
  }
]

function detectarTemaRestrito(texto) {
  const instrucao = String(texto || '').trim()
  if (!instrucao) return null
  return RESTRICTIONS.find(item => item.pattern.test(instrucao)) || null
}

module.exports = { detectarTemaRestrito }
