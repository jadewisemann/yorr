import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_ENABLE_MSW 가 false(전부 실서버) 또는 fallback(실서버 우선, 없는 API 만 mock)이면
  // 실제 서버에 붙는다. 어느 서버인지는 VITE_API_TARGET 이 정한다:
  //   remote(기본) → 배포된 dev 서버. API 를 /dev-api/v1/... 로 노출하므로 /api → /dev-api rewrite.
  //   local        → 내 PC 의 백엔드(localhost:8080). 서버 코드까지 같이 확인할 때 쓴다.
  // VITE_WS_URL 은 프록시를 타지 않으니 여기와 같은 서버를 가리키게 따로 맞춰야 한다.
  const usesRealServer = env.VITE_ENABLE_MSW === 'false' || env.VITE_ENABLE_MSW === 'fallback'
  const useRemoteApi = usesRealServer && env.VITE_API_TARGET !== 'local'

  return {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: { '@': '/src' },
    },
    server: {
      host: true,
      port: 5173,
      // 실기기 모션 센서 테스트용. iOS Safari는 보안 컨텍스트(HTTPS)가 아니면 devicemotion을
      // 아예 막으므로 http://<LAN IP>:5173 으로는 확인할 수 없다. 터널로 HTTPS 주소를 열어
      // 폰에서 접속할 때 vite가 그 호스트를 거부하지 않도록 허용한다(dev 서버 전용).
      allowedHosts: ['.trycloudflare.com', '.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'],
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
