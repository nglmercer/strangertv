import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    rollupOptions: {
      output: {
        // Keep the initial `index` chunk small and cache-stable: framework
        // code changes rarely, app code on every deploy.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/preact')) return 'vendor-preact'
            return 'vendor'
          }
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
})
