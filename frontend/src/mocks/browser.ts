import { setupWorker } from 'msw/browser'
import { createRestHandlers } from './restHandlers'
import { createServerFirstHandler } from './serverFirstHandler'

export function createMockApiWorker(mode: 'mock' | 'fallback') {
  const handlers = createRestHandlers()
  return mode === 'fallback'
    ? setupWorker(createServerFirstHandler(), ...handlers)
    : setupWorker(...handlers)
}
