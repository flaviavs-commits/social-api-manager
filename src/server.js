require('dotenv').config()
const express  = require('express')
const path     = require('path')

const accountsRoutes = require('./routes/accounts')
const tokensRoutes   = require('./routes/tokens')
const logsRoutes     = require('./routes/logs')
const postsRoutes    = require('./routes/posts')
const oauthRoutes    = require('./routes/oauth')

const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

app.use('/api/accounts', accountsRoutes)
app.use('/api/tokens',   tokensRoutes)
app.use('/api/logs',     logsRoutes)
app.use('/api/posts',    postsRoutes)
app.use('/auth',         oauthRoutes)
app.use('/oauth',        oauthRoutes)

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'))
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
})