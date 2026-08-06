import { RouterProvider } from '@tanstack/react-router'
import { useAuthSessionCheck } from '@/auth/model/useAuthSessionCheck'
import { resolveMswMode } from '@/mocks/mswMode'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
import { VoiceProvider } from '@/realtime/voice/VoiceContext'
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
        {/* 라우터 **밖**이라는 게 요점이다 — 대기실에서 게임으로 넘어가도 통화가 끊기지 않는다.
            RealtimeSync 안쪽이어야 소켓 client를 쓸 수 있다. */}
        <VoiceProvider>
          <RouterProvider router={router} />
        </VoiceProvider>
      </RealtimeSync>
    </InAppBrowserGate>
  )
}
