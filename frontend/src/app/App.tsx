import { RouterProvider } from '@tanstack/react-router'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
import { InAppBrowserGate } from './InAppBrowserGate'
import { RealtimeSync } from './RealtimeSync'
import { router } from './router'

const realtimeClient =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW !== 'false'
    ? createRealtimeFixture()
    : new WebSocketRealtimeClient()

export function App() {
  return (
    <InAppBrowserGate>
      <RealtimeSync client={realtimeClient}>
        <RouterProvider router={router} />
      </RealtimeSync>
    </InAppBrowserGate>
  )
}
