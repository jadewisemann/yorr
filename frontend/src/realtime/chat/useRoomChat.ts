import { useCallback, useEffect, useState } from 'react'
import { useRealtimeClient } from '../RealtimeClientContext'
import { buildClientMessage, CHAT_TEXT_MAX_LENGTH, type PlayerId } from '../wsEvents'

/**
 * 화면에 남기는 최근 대화 줄 수. 서버가 이력을 주지 않으므로 이 배열이 유일한 기록이고,
 * 방 하나의 수명(게임 한 판)에서 이보다 위로 올려 볼 이유가 없다. 무한히 쌓으면 긴 판에서
 * 리스트가 계속 자라 스크롤 컨테이너가 느려진다.
 */
export const CHAT_HISTORY_LIMIT = 50

export interface ChatLine {
  messageId: string
  playerId: PlayerId
  nickname: string
  text: string
  at: number
}

export interface RoomChat {
  lines: ChatLine[]
  /** 마지막으로 읽은 뒤 도착한 **남의** 말 개수. 내가 보낸 말은 세지 않는다. */
  unread: number
  send: (text: string) => void
  markRead: () => void
}

/**
 * 방 텍스트 채팅. `chat.message`를 모아 두고 `chat.send`로 한 줄을 보낸다.
 *
 * 상태를 전역 store에 두지 않는 이유: 대화는 서버 권위 상태가 아니라 **방에 머무는 동안의
 * 로컬 기록**이다(DESIGN.md 원칙 3의 ② 로컬 UI 상태). 방이 바뀌거나 방을 나가면 기록을
 * 버린다 — `you`가 그 판정의 열쇠다(방 밖에서는 빈 문자열이다).
 */
export function useRoomChat(you: PlayerId): RoomChat {
  const client = useRealtimeClient()
  const [lines, setLines] = useState<ChatLine[]>([])
  const [readCount, setReadCount] = useState(0)

  useEffect(
    () =>
      client.onMessage((message) => {
        if (message.type !== 'chat.message') return
        const line = message.payload
        setLines((current) =>
          // 같은 messageId가 두 번 오는 것은 중복 배달이다 — 같은 말이 두 줄로 쌓이지 않게 버린다.
          current.some((item) => item.messageId === line.messageId)
            ? current
            : [...current, line].slice(-CHAT_HISTORY_LIMIT),
        )
      }),
    [client],
  )

  /*
   * 방이 바뀌면 기록을 버린다. useEffect가 아니라 **렌더 중 조정**인 이유: effect로 지우면
   * 새 방의 첫 프레임에 옛 방의 대화가 한 번 그려진다(React 공식 "prop이 바뀔 때 state 조정"
   * 패턴).
   */
  const [roomOf, setRoomOf] = useState(you)
  if (roomOf !== you) {
    setRoomOf(you)
    setLines([])
    setReadCount(0)
  }

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed.length === 0 || trimmed.length > CHAT_TEXT_MAX_LENGTH) return
      try {
        client.send(buildClientMessage('chat.send', { text: trimmed }))
      } catch {
        // 끊긴 소켓에 보내려다 던진 경우다. 재연결한 뒤 다시 입력하면 되므로 조용히 넘긴다.
      }
    },
    [client],
  )

  /*
   * 읽음 기준선은 인덱스가 아니라 **남이 보낸 말의 누적 개수**다. 인덱스로 두면
   * CHAT_HISTORY_LIMIT을 넘어 앞줄이 잘려 나갈 때 기준선이 함께 밀려서, 읽지 않은 말이
   * 읽음으로 바뀐다.
   */
  const fromOthers = lines.filter((line) => line.playerId !== you).length
  const markRead = useCallback(() => setReadCount(fromOthers), [fromOthers])

  return { lines, unread: Math.max(0, fromOthers - readCount), send, markRead }
}
