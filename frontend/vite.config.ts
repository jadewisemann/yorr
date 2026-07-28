import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // MSW 를 끄면(VITE_ENABLE_MSW=false) 로컬 백엔드 대신 배포된 dev 서버로 붙는다.
  // 배포 서버는 API 를 /dev-api/v1/... 로 노출하므로 /api → /dev-api 로 rewrite 한다.
  const useRemoteApi = env.VITE_ENABLE_MSW === 'false'

  return {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: { '@': '/src' },
    },
    server: {
      host: true,
      port: 5173,
      // dev 전용. VITE_API_BASE_URL 은 상대경로(/api/v1)로 둬야 MSW 핸들러가 그대로 동작하므로,
      // 백엔드는 절대 URL 대신 이 프록시로 붙인다. production build 에는 영향 없다.
      proxy: {
        '/api': useRemoteApi
          ? {
              target: 'https://i15a406.p.ssafy.io',
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, '/dev-api'),
            }
          : {
              target: 'http://localhost:8080',
              changeOrigin: true,
            },
      },
    },
  }
})
