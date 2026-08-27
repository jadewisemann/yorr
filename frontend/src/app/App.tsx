import { RouterProvider } from '@tanstack/react-router'
import { useAuthSessionCheck } from '@/auth/model/useAuthSessionCheck'
import { resolveMswMode } from '@/mocks/mswMode'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { ChatProvider } from '@/realtime/chat/ChatContext'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
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
        <ChatProvider>
          <RouterProvider router={router} />
        </ChatProvider>
      </RealtimeSync>
    </InAppBrowserGate>
  )
}
