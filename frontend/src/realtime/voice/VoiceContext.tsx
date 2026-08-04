import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { useVoiceChat, type VoiceChat } from './useVoiceChat'

/**
 * 음성 채팅을 화면보다 위에 둔다 — 대기실 → 게임으로 넘어가도 통화가 끊기지 않게.
 *
 * 화면마다 useVoiceChat을 부르면 라우트가 바뀔 때 훅이 언마운트되면서 연결이 전부 닫히고,
 * 새 화면에서 처음부터 다시 협상한다(1~2초 무음). Provider를 라우터 **위**(App)에 두면
 * 라우트 전환이 이 트리를 건드리지 않으므로 통화가 그대로 이어진다.
 */

/**
 * Provider 없이 렌더된 화면이 보는 값. 던지지 않고 "마이크 못 씀"으로 떨어진다 —
 * VoiceButton이 unsupported면 스스로 사라지므로 화면은 음성 기능만 없는 상태로 정상 동작한다.
 * (RealtimeClientContext는 없으면 던진다. 그건 없으면 앱이 아예 안 돌아가기 때문이고,
 *  음성은 없어도 게임이 돌아가므로 심각도가 다르다.)
 */
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
  // 내 playerId는 방에 들어간 뒤에 정해진다. Provider가 스토어에서 직접 읽으므로
  // 화면들은 you를 넘길 필요가 없다.
  const you = useAppStore((state) => state.roomSession?.you)
  const voice = useVoiceChat(you ?? '')

  // 방을 떠나면 마이크를 끈다. 예전에는 화면 언마운트가 이 일을 대신했는데, Provider가
  // 라우터 위로 올라오면서 화면이 사라져도 살아 있다 — 켜진 채로 남으면 사용자가 모른다.
  const wasInRoomRef = useRef(false)
  useEffect(() => {
    const inRoom = you !== undefined
    if (wasInRoomRef.current && !inRoom && voice.status === 'on') voice.toggle()
    wasInRoomRef.current = inRoom
  }, [you, voice])

  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>
}

/** 화면에서 음성 상태를 읽는 유일한 경로. Provider가 없으면 "마이크 못 씀"이 온다. */
export function useVoice() {
  return useContext(VoiceContext)
}
