import { RouterProvider } from '@tanstack/react-router'
import { domAnimation, LazyMotion } from 'motion/react'
import { resolveMswMode } from '@/mocks/mswMode'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
import { InAppBrowserGate } from './InAppBrowserGate'
import { RealtimeSync } from './RealtimeSync'
import { router } from './router'
import { useAuthSessionCheck } from './useAuthSessionCheck'

// fallback 모드는 실서버가 떠 있는 게 전제라 WS 도 실서버에 붙는다. mock WS 는 'mock' 모드에서만.
const realtimeClient =
  resolveMswMode() === 'mock' ? createRealtimeFixture() : new WebSocketRealtimeClient()

export function App() {
  useAuthSessionCheck()

  return (
    // LazyMotion + domAnimation: 전체 motion 대신 DOM 애니메이션 기능만 싣는다.
    // 컴포넌트는 motion.div가 아니라 m.div를 쓴다 — 그래야 나머지가 트리셰이킹된다.
    <LazyMotion features={domAnimation} strict>
      <InAppBrowserGate>
        <RealtimeSync client={realtimeClient}>
          <RouterProvider router={router} />
        </RealtimeSync>
      </InAppBrowserGate>
    </LazyMotion>
  )
}
