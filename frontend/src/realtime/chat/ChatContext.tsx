import { createContext, type ReactNode, useContext } from 'react'
import { useAppStore } from '@/store'
import { type RoomChat, useRoomChat } from './useRoomChat'

/**
 * provider 밖에서 `useChat()`을 부른 경우의 강등값. 던지지 않는 이유는 음성 채팅에서와
 * 같다 — 대화가 없어도 게임은 돌아가므로, dev 화면·단독 렌더 테스트에서 앱을 세울 만한
 * 심각도가 아니다. (`useRealtimeClient`는 던진다: 그건 없으면 아무것도 못 한다.)
 */
const NO_CHAT: RoomChat = {
  lines: [],
  send: () => undefined,
}

const ChatContext = createContext<RoomChat>(NO_CHAT)

/**
 * **라우터 위**에 둔다. 화면마다 훅을 부르면 대기실 → 게임으로 넘어갈 때 그 화면의
 * 훅이 언마운트되며 대화가 통째로 사라진다 — 방은 그대로인데 기록만 없어진다.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const you = useAppStore((state) => state.roomSession?.you)
  const chat = useRoomChat(you ?? '')

  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>
}

export function useChat() {
  return useContext(ChatContext)
}
