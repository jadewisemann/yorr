import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { defineConfig, loadEnv } from 'vite'

// 배포 dev 서버는 REST 를 /dev-api/v1/..., WS 를 /dev-ws/v1/... 로 노출한다.
// 로컬 백엔드(localhost:8080)는 접두어 없이 /api/v1, /ws/v1 그대로다.
const DEPLOYED_DEV_ORIGIN = 'https://i15a406.p.ssafy.io'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 실서버 모드(VITE_ENABLE_MSW=false)의 기본 대상은 배포 dev 서버 — env 없이 바로 돈다.
  // 로컬 백엔드를 쓰려면 VITE_BACKEND_ORIGIN=http://localhost:8080 (.env.example 참고).
  const backendOrigin = env.VITE_BACKEND_ORIGIN || DEPLOYED_DEV_ORIGIN
  const useDeployedPrefix = backendOrigin === DEPLOYED_DEV_ORIGIN

  // 브라우저가 실은 Origin(127.0.0.1:4306 등)이 백엔드 CORS 허용 목록에 없으면
  // 403(Invalid CORS request)이 난다. 프록시 경유는 same-origin 접근이므로 Origin 을
  // 아예 떼고 전달한다 — CORS 검사 대상이 아니게 된다. (REST 요청과 WS 핸드셰이크 둘 다)
  const stripBrowserOrigin: NonNullable<ProxyOptions['configure']> = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
    proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'))
  }

  // VITE_API_BASE_URL 은 상대경로(/api/v1)로 둬야 MSW 핸들러가 그대로 동작하므로,
  // 백엔드는 절대 URL 대신 이 프록시로 붙는다. production build 산출물 자체에는 영향 없다.
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: backendOrigin,
      changeOrigin: true,
      configure: stripBrowserOrigin,
      ...(useDeployedPrefix && {
        rewrite: (path: string) => path.replace(/^\/api/, '/dev-api'),
      }),
    },
    '/ws': {
      target: backendOrigin,
      changeOrigin: true,
      ws: true,
      configure: stripBrowserOrigin,
      ...(useDeployedPrefix && {
        rewrite: (path: string) => path.replace(/^\/ws/, '/dev-ws'),
      }),
    },
  }

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
      proxy,
    },
    // vite preview(E2E real 모드의 webServer)도 같은 프록시를 탄다.
    preview: {
      proxy,
    },
  }
})
