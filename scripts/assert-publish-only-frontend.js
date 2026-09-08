const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const checks = [
  {
    file: 'frontend/src/pages/scheduler-page.jsx',
    forbidden: [
      'Agendar publicação',
      'scheduledPublicationDetails',
      'Processando e salvando agendamento',
      'type="datetime-local"'
    ]
  },
  {
    file: 'frontend/src/pages/calendar-page.jsx',
    forbidden: [
      'Agendar novo post',
      'Reagendar este post',
      'onDrop={',
      'draggable={isScheduled(post)}',
      'copyScheduled',
      'repeatPost'
    ]
  },
  {
    file: 'frontend/src/pages/dashboard-page.jsx',
    forbidden: ['Agendar agora']
  },
  {
    file: 'frontend/src/pages/landing-page.jsx',
    forbidden: ['Agendar post', 'Agendamento e publicação multiplataforma.']
  }
]

const violations = []
for (const check of checks) {
  const filePath = path.join(root, check.file)
  const source = fs.readFileSync(filePath, 'utf8')
  for (const token of check.forbidden) {
    if (source.includes(token)) violations.push(`${check.file}: ${token}`)
  }
}

if (violations.length) {
  console.error('A função de agendamento reapareceu no front-end:')
  violations.forEach(violation => console.error(`- ${violation}`))
  process.exit(1)
}

console.log('Front-end confirmado no modo de publicação imediata.')
