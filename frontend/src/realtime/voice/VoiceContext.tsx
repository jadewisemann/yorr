import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { useVoiceChat, type VoiceChat } from './useVoiceChat'

const NO_VOICE: VoiceChat = {
  mutedPeers: new Set(),
  peers: [],
  speaking: new Set(),
  status: 'unsupported',
  toggle: () => undefined,
  toggleMutePeer: () => undefined,
}

const VoiceContext = createContext<VoiceChat>(NO_VOICE)

export function VoiceProvider({ children }: { children: ReactNode }) {
  const you = useAppStore((state) => state.roomSession?.you)
  const voice = useVoiceChat(you ?? '')

  const wasInRoomRef = useRef(false)
  useEffect(() => {
    const inRoom = you !== undefined
    if (wasInRoomRef.current && !inRoom && voice.status === 'on') voice.toggle()
    wasInRoomRef.current = inRoom
  }, [you, voice])

  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  return useContext(VoiceContext)
}
