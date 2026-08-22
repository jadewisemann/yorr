import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { defineConfig, loadEnv } from 'vite'

const DEPLOYED_DEV_ORIGIN = 'https://i15a406.p.ssafy.io'

const assertSecureEndpoint = (name: string, value: string | undefined, wsScheme: boolean) => {
  if (value === undefined || value === '' || value.startsWith('/')) return

  const secure = wsScheme ? 'wss://' : 'https://'
  const plain = wsScheme ? 'ws://' : 'http://'
  if (value.startsWith(secure)) return

  const local = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:$|\/)/
  if (value.startsWith(plain) && local.test(value.slice(plain.length))) return

  throw new Error(
    `${name} 은 ${secure} 또는 상대경로여야 한다(HTTPS 페이지에서 ${plain} 는 ` +
      `mixed content 로 차단된다): ${value}`,
  )
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  if (command === 'build') {
    assertSecureEndpoint('VITE_API_BASE_URL', env.VITE_API_BASE_URL, false)
    assertSecureEndpoint('VITE_WS_URL', env.VITE_WS_URL, true)
  }

  const backendOrigin = env.VITE_BACKEND_ORIGIN || DEPLOYED_DEV_ORIGIN
  const useDeployedPrefix = backendOrigin === DEPLOYED_DEV_ORIGIN

  const stripBrowserOrigin: NonNullable<ProxyOptions['configure']> = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
    proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'))
  }

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

      port: Number(env.PORT ?? 5173),

      allowedHosts: ['.trycloudflare.com', '.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'],
      proxy,
    },

    preview: {
      proxy,
    },
  }
})
