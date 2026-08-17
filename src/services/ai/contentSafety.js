const RESTRICTIONS = [
  {
    id: 'medical',
    pattern: /\b(?:m[eé]dic|diagn[oó]stic|s[ií]ntoma|doen[cç]a|rem[eé]dio|medicamento|tratamento|terapia|cirurgia|dosagem|prescri[cç]|exame cl[ií]nico|psicol[oó]g|psiquiatr|sa[uú]de)\b/i,
    message: 'A IA não está autorizada a criar conteúdo médico, clínico ou de saúde. Consulte um profissional habilitado.'
  },
  {
    id: 'legal',
    pattern: /\b(?:jur[ií]dic|advogad|processo judicial|a[cç][aã]o judicial|contrato|lei|direito|tribunal|crime|penal|c[ií]vel|trabalhist|imigra[cç]|div[oó]rcio|pens[aã]o aliment[ií]cia)\b/i,
    message: 'A IA não está autorizada a criar conteúdo jurídico ou oferecer orientação legal. Consulte um advogado.'
  },
  {
    id: 'adult',
    pattern: /\b(?:conte[uú]do adulto|sexo|sexual|porn[oô]|er[oó]tic|nude|nudes|xxx|prostitui[cç]|fetiche|onlyfans)\b|\+18/i,
    message: 'A IA não está autorizada a criar conteúdo adulto, sexual ou +18.'
  },
  {
    id: 'deep_finance',
    pattern: /\b(?:investi(?:mento|r)|a[cç][oõ]es|cripto(?:moeda)?|bitcoin|forex|day trade|trading|carteira de investimento|financiamento|empr[eé]stimo|juros|imposto|previd[eê]ncia|renda vari[aá]vel|op[cç][oõ]es bin[aá]rias|derivativos|seguro)\b/i,
    message: 'A IA não está autorizada a produzir análises ou recomendações financeiras aprofundadas. Procure um profissional habilitado.'
  }
]

function detectarTemaRestrito(texto) {
  const instrucao = String(texto || '').trim()
  if (!instrucao) return null
  return RESTRICTIONS.find(item => item.pattern.test(instrucao)) || null
}

module.exports = { detectarTemaRestrito }
