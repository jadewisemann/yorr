import { RouterProvider } from '@tanstack/react-router'
import { useAuthSessionCheck } from '@/auth/model/useAuthSessionCheck'
import { resolveMswMode } from '@/mocks/mswMode'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
import { VoiceProvider } from '@/realtime/voice/VoiceContext'
import { InAppBrowserGate } from './InAppBrowserGate'
import { useThemeSync } from './model/useThemeSync'
import { RealtimeSync } from './RealtimeSync'
import { router } from './router'

const realtimeClient =
  resolveMswMode() === 'mock' ? createRealtimeFixture() : new WebSocketRealtimeClient()

export function App() {
  useAuthSessionCheck()
  useThemeSync()

  return (
    <InAppBrowserGate>
      <RealtimeSync client={realtimeClient}>
        <VoiceProvider>
          <RouterProvider router={router} />
        </VoiceProvider>
      </RealtimeSync>
    </InAppBrowserGate>
  )
}
