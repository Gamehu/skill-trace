import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 4317}` } },
  },
})
