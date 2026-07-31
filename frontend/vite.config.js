import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../public/react', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/oauth': 'http://localhost:3000',
      '/media-proxy': 'http://localhost:3000'
    }
  }
})
