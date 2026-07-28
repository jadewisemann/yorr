import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    host: true,
    port: 5173,
    // dev 전용. VITE_API_BASE_URL 은 상대경로(/api/v1)로 둬야 MSW 핸들러가 그대로 동작하므로,
    // 로컬 백엔드는 절대 URL 대신 이 프록시로 붙인다. production build 에는 영향 없다.
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
