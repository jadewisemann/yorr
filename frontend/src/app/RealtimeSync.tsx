import type { ReactNode } from 'react'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import { useRealtimeConnection } from './useRealtimeConnection'

interface RealtimeSyncProps {
  children: ReactNode
  client: RealtimeClient
}

/**
 * 실시간 연결의 진입점 — 연결 수명주기는 `useRealtimeConnection`, 서버 메시지
 * 리듀서는 `realtimeHandlers`, 디스패치 표는 `messageDispatch`가 맡는다.
 *
 * 이 파일이 얇은 것이 의도다. 예전에는 소켓 수명주기와 리듀서가 한 파일에 100줄로
 * 있었고, "연결이 언제 끊기고 메시지가 어떻게 반영되는가"가 서로를 가렸다.
 */
export function RealtimeSync({ children, client }: RealtimeSyncProps) {
  useRealtimeConnection(client)

  return <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
}
