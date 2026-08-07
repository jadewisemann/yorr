export type MswMode = 'mock' | 'fallback' | 'off'

export function resolveMswMode(): MswMode {
  if (!import.meta.env.DEV) return 'off'
  switch (import.meta.env.VITE_ENABLE_MSW) {
    case 'false':
      return 'off'
    case 'fallback':
      return 'fallback'
    default:
      return 'mock'
  }
}
