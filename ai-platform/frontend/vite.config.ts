import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Defaults keep `npm run dev` on the host working. In the dev compose profile the
// API lives at http://backend:3000, and the browser reaches vite through the
// published 9900 port, so the HMR socket has to be told that port explicitly.
const apiTarget = process.env.API_TARGET || 'http://localhost:3000'
const port = Number(process.env.VITE_PORT) || 5173
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT) || 0

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port,
    ...(hmrClientPort ? { hmr: { clientPort: hmrClientPort } } : {}),
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: apiTarget.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
})
