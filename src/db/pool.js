const { Pool, types } = require('pg')

// Colunas "timestamp without time zone" são gravadas em UTC (NOW() do Postgres
// está em UTC). Por padrão o driver as interpreta como horário local do
// processo Node, o que adianta as datas em 3h. Forçamos a leitura como UTC.
types.setTypeParser(types.builtins.TIMESTAMP, str => str ? new Date(str + 'Z') : null)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Default do driver é max=10, o que esgota rápido com várias chamadas
  // paralelas (dashboard, analytics) concorrendo pela mesma conexão. Subido
  // para 30 depois que a publicação multi-plataforma/multi-post passou a
  // rodar em paralelo (publisher.js, scheduler.js), aumentando o pico de
  // queries concorrentes por publicação.
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
})

module.exports = pool
