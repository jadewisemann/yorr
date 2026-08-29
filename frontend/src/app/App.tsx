import { RouterProvider } from '@tanstack/react-router'
import { useAuthSessionCheck } from '@/auth/model/useAuthSessionCheck'
import { resolveMswMode } from '@/mocks/mswMode'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { ChatProvider } from '@/realtime/chat/ChatContext'
import { ControllerLinkProvider } from '@/realtime/controllerLink/ControllerLinkContext'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
import { useControllerLinkRole } from '@/room/model/useControllerLinkRole'
import { InAppBrowserGate } from './InAppBrowserGate'
import { useThemeSync } from './model/useThemeSync'
import { RealtimeSync } from './RealtimeSync'
import { router } from './router'

const realtimeClient =
  resolveMswMode() === 'mock' ? createRealtimeFixture() : new WebSocketRealtimeClient()

export function App() {
  useAuthSessionCheck()
  useThemeSync()
  const controllerLinkRole = useControllerLinkRole()

  return (
    <InAppBrowserGate>
      <RealtimeSync client={realtimeClient}>
        <ControllerLinkProvider linkRole={controllerLinkRole}>
          <ChatProvider>
            <RouterProvider router={router} />
          </ChatProvider>
        </ControllerLinkProvider>
      </RealtimeSync>
    </InAppBrowserGate>
  )
}
