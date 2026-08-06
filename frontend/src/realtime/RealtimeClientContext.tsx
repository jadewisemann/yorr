import { createContext, type ReactNode, useContext } from 'react'
import type { RealtimeClient } from './realtimeClient'

const RealtimeClientContext = createContext<RealtimeClient | null>(null)

interface RealtimeClientProviderProps {
  children: ReactNode
  client: RealtimeClient
}

export function RealtimeClientProvider({ children, client }: RealtimeClientProviderProps) {
  return <RealtimeClientContext.Provider value={client}>{children}</RealtimeClientContext.Provider>
}

export function useRealtimeClient() {
  const client = useContext(RealtimeClientContext)
  if (!client) throw new Error('Realtime client is not available')
  return client
}

/**
 * 소켓이 없을 수도 있는 화면용. 없으면 null이다.
 *
 * 로컬 게임(연습·AI 대전)은 서버 없이 도는 것이 전제다 — 거기에 실시간 기능을 <b>얹을 때</b>
 * 위의 던지는 버전을 쓰면, 소켓과 아무 상관 없던 화면이 provider 없이는 뜨지도 않게 된다.
 * 방을 열기 전까지는 없는 것이 정상이므로 없음을 값으로 받는다.
 */
export function useOptionalRealtimeClient() {
  return useContext(RealtimeClientContext)
}
