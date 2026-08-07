import { resolveMswMode } from './mswMode'

export async function enableMocking() {
  const mode = resolveMswMode()
  if (mode === 'off') return

  const { createMockApiWorker } = await import('./browser')
  await createMockApiWorker(mode).start({
    onUnhandledRequest: mode === 'fallback' ? 'bypass' : 'error',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
