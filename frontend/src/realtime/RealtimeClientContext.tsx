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
