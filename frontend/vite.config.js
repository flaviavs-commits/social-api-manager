import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../public/react', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) }
  },
  server: {
    // Force IPv4 127.0.0.1 instead of the default "localhost" bind. On
    // machines where "localhost" resolves to ::1 first, browsers that ever
    // cached an HSTS policy for "localhost" (Strict-Transport-Security from
    // some other local server, includeSubDomains covering *.localhost too)
    // silently rewrite every http:// request to https:// and fail with
    // ERR_SSL_PROTOCOL_ERROR against this plain-HTTP dev server. HSTS never
    // applies to literal IP addresses, so 127.0.0.1 sidesteps it entirely.
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/oauth': 'http://localhost:3000',
      '/media-proxy': 'http://localhost:3000'
    }
  }
})
