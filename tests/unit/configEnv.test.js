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

  test('recusa modos de revisão em produção', () => {
    const validProduction = {
      NODE_ENV: 'production',
      AUTH_TOKEN_SECRET: 'a'.repeat(32), SESSION_SECRET: 'b'.repeat(32), CRON_SECRET: 'c'.repeat(32),
      TOKEN_ENCRYPTION_KEY: 'd'.repeat(64), DATABASE_URL: 'postgres://db',
      BASE_URL: 'https://api.example.com', FRONTEND_URL: 'https://app.example.com',
      FRONTEND_ORIGIN: 'https://app.example.com', BLOB_ALLOWED_HOSTS: 'storage.public.blob.vercel-storage.com',
      TRUST_PROXY: '1', REVIEW_MODE_NO_AUTH: 'true'
    }
    expect(() => assertProductionSecrets(validProduction)).toThrow(/modos de revisão/i)
  })

  test('recusa Bearer legado em produção', () => {
    const validProduction = {
      NODE_ENV: 'production',
      AUTH_TOKEN_SECRET: 'a'.repeat(32), SESSION_SECRET: 'b'.repeat(32), CRON_SECRET: 'c'.repeat(32),
      TOKEN_ENCRYPTION_KEY: 'd'.repeat(64), DATABASE_URL: 'postgres://db',
      BASE_URL: 'https://api.example.com', FRONTEND_URL: 'https://app.example.com',
      FRONTEND_ORIGIN: 'https://app.example.com', BLOB_ALLOWED_HOSTS: 'storage.public.blob.vercel-storage.com',
      TRUST_PROXY: '1', ALLOW_LEGACY_BEARER: 'true'
    }
    expect(() => assertProductionSecrets(validProduction)).toThrow(/ALLOW_LEGACY_BEARER/i)
  })

  test('não libera modo de revisão sem ambiente explícito', () => {
    expect(() => assertProductionSecrets({ REVIEW_MODE_NO_AUTH: 'true' })).toThrow(/NODE_ENV/i)
    expect(() => assertProductionSecrets({ TIKTOK_REVIEW_MODE: 'true' })).toThrow(/NODE_ENV/i)
  })

  test('exige NODE_ENV em ambientes hospedados', () => {
    expect(() => assertProductionSecrets({ RAILWAY_ENVIRONMENT: 'production' })).toThrow(/NODE_ENV/i)
    expect(() => assertProductionSecrets({ VERCEL_ENV: 'production' })).toThrow(/NODE_ENV/i)
  })

  test('exige credencial do Blob ao ativar modo privado', () => {
    const production = {
      NODE_ENV: 'production',
      AUTH_TOKEN_SECRET: 'a'.repeat(32), SESSION_SECRET: 'b'.repeat(32), CRON_SECRET: 'c'.repeat(32),
      TOKEN_ENCRYPTION_KEY: 'd'.repeat(64), DATABASE_URL: 'postgres://db',
      BASE_URL: 'https://api.example.com', FRONTEND_URL: 'https://app.example.com',
      FRONTEND_ORIGIN: 'https://app.example.com', BLOB_ALLOWED_HOSTS: 'storage.public.blob.vercel-storage.com',
      TRUST_PROXY: '1', BLOB_ACCESS_MODE: 'private'
    }
    expect(() => assertProductionSecrets(production)).toThrow(/modo privado do Blob/i)
    expect(() => assertProductionSecrets({ ...production, BLOB_READ_WRITE_TOKEN: 'blob-token' })).not.toThrow()
  })
})
