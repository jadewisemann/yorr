import { RouterProvider } from '@tanstack/react-router'
import { useAuthSessionCheck } from '@/auth/useAuthSessionCheck'
import { resolveMswMode } from '@/mocks/mswMode'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
import { InAppBrowserGate } from './InAppBrowserGate'
import { RealtimeSync } from './RealtimeSync'
import { router } from './router'

// fallback 모드는 실서버가 떠 있는 게 전제라 WS 도 실서버에 붙는다. mock WS 는 'mock' 모드에서만.
const realtimeClient =
  resolveMswMode() === 'mock' ? createRealtimeFixture() : new WebSocketRealtimeClient()

export function App() {
  useAuthSessionCheck()

  return (
    <InAppBrowserGate>
      <RealtimeSync client={realtimeClient}>
        <RouterProvider router={router} />
      </RealtimeSync>
    </InAppBrowserGate>
  )
}
