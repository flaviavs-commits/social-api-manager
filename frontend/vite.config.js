import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // basicSsl generates a local self-signed certificate and switches the dev
  // server to HTTPS automatically (no server.https needed). Some machines'
  // browsers have an HSTS policy cached for "localhost" (Strict-Transport-
  // Security with includeSubDomains, set by some other local server at some
  // point) that forces https:// for that host no matter what — serving real
  // TLS here satisfies that instead of fighting it. The browser still shows
  // a one-time "not trusted" warning for the self-signed cert; click through
  // it ("Advanced" → "Proceed to localhost").
  plugins: [react(), basicSsl()],
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../public/react', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) }
  },
  server: {
    // Listen on every interface so "localhost" resolves correctly whether
    // this machine prefers ::1 or 127.0.0.1 for it.
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/oauth': 'http://localhost:3000',
      '/media-proxy': 'http://localhost:3000'
    }
  }
})
