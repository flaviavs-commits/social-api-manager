const { csv, boolean, readEnv, assertProductionSecrets } = require('../../src/config/env')

describe('config/env', () => {
  test('normaliza listas e booleanos', () => {
    expect(csv(' a, b ,,c ')).toEqual(['a', 'b', 'c'])
    expect(boolean('TRUE')).toBe(true)
    expect(boolean('off', true)).toBe(false)
    expect(boolean(undefined, true)).toBe(true)
  })

  test('lê configuração sem expor o objeto process.env', () => {
    const config = readEnv({
      NODE_ENV: 'test', PORT: '3010', BASE_URL: 'https://api.test/',
      FRONTEND_URL: 'https://app.test/', FRONTEND_ORIGIN: 'https://app.test, http://localhost:5173',
      TRUST_PROXY: '2'
    })
    expect(config).toMatchObject({
      nodeEnv: 'test', port: 3010, baseUrl: 'https://api.test',
      frontendUrl: 'https://app.test', allowedOrigins: ['https://app.test', 'http://localhost:5173'], trustProxy: 2
    })
    expect(Object.isFrozen(config)).toBe(true)
  })

  test('exige segredos mínimos somente em produção', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'test' })).not.toThrow()
    expect(() => assertProductionSecrets({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/)
    expect(() => assertProductionSecrets({
      NODE_ENV: 'production',
      AUTH_TOKEN_SECRET: 'a'.repeat(32), SESSION_SECRET: 'b'.repeat(32), CRON_SECRET: 'c'.repeat(32),
      TOKEN_ENCRYPTION_KEY: 'd'.repeat(64), DATABASE_URL: 'postgres://db',
      BASE_URL: 'https://api.example.com', FRONTEND_URL: 'https://app.example.com',
      FRONTEND_ORIGIN: 'https://app.example.com', BLOB_ALLOWED_HOSTS: 'storage.public.blob.vercel-storage.com',
      TRUST_PROXY: '1'
    })).not.toThrow()
  })
})
