const fs = require('fs')
const path = require('path')
const { assertProductionSecrets } = require('../src/config/env')

function fail(message) {
  console.error(`SECURITY PREFLIGHT FAILED: ${message}`)
  process.exitCode = 1
}

if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
  fail('NODE_ENV=production é obrigatório para o preflight de deploy.')
}

try {
  assertProductionSecrets()
} catch (error) {
  fail(error.message)
}

if (String(process.env.ALLOW_LEGACY_BEARER || '').toLowerCase() === 'true') {
  fail('ALLOW_LEGACY_BEARER não pode estar ativo.')
}

const migration = path.join(__dirname, '../src/db/migrations/063_security_hardening.sql')
if (!fs.existsSync(migration)) fail('Migration 063_security_hardening.sql não está presente.')

const sourceMaps = []
const assetsDir = path.join(__dirname, '../public/react/assets')
if (fs.existsSync(assetsDir)) {
  for (const entry of fs.readdirSync(assetsDir)) {
    if (entry.endsWith('.map')) sourceMaps.push(entry)
  }
}
if (sourceMaps.length) fail(`Source maps não devem ser publicados: ${sourceMaps.join(', ')}`)

if (!process.exitCode) console.log('Security preflight OK: configuração de produção e artefatos básicos verificados.')
