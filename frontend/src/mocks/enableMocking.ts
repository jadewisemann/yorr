export async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MSW === 'false') return

  const { mockApiWorker } = await import('./browser')
  await mockApiWorker.start({
    onUnhandledRequest: 'error',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
