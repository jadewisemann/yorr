import { resolveMswMode } from './mswMode'

export async function enableMocking() {
  const mode = resolveMswMode()
  if (mode === 'off') return

  const { createMockApiWorker } = await import('./browser')
  await createMockApiWorker(mode).start({
    // fallback 모드에서는 mock handler 에 없는 요청이 실서버로 그대로 나가야 한다.
    onUnhandledRequest: mode === 'fallback' ? 'bypass' : 'error',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
