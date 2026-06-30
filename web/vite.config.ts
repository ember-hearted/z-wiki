import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SERVER_PORT = Number(process.env.PORT ?? 3000)

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${SERVER_PORT}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
