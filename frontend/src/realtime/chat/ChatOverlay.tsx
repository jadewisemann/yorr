import { useEffect } from 'react'
import { cn } from '@/shared/cn'
import type { PlayerId } from '../wsEvents'
import { chatLabel } from './ChatDialog'
import type { RoomChat } from './useRoomChat'

interface ChatOverlayProps {
  chat: RoomChat
  className?: string | undefined
  onOpen: () => void
  you: PlayerId
}

/** 판 위에 겹쳐 보여 줄 줄 수. 더 쌓으면 주사위를 가리고, 한 줄이면 오간 흐름이 안 읽힌다. */
const VISIBLE_LINES = 3

/**
 * 좁은 화면 게임판 위에 겹치는 **최근 대화**. 대기실처럼 패널을 상주시킬 세로 공간이 없어
 * (굴리기 푸터·기록 패널·리액션 독이 이미 화면 아래를 층층이 쓴다) 대화만 판 위로 띄우고,
 * 입력은 눌렀을 때 바텀시트에서 한다.
 *
 * 스크린리더에는 이것을 **읽히지 않는다** — 같은 대화를 시트 안 `role="log"`가 이미 읽어
 * 주므로 여기서 또 읽으면 새 말마다 두 번 들린다. 버튼의 이름만 안 읽은 수를 전한다.
 */
export function ChatOverlay({ chat, className, onOpen, you }: ChatOverlayProps) {
  const { lines, markRead } = chat
  const recent = lines.slice(-VISIBLE_LINES)

  /*
   * 이것이 떠 있는 동안은 읽음이다 — 대화가 판 위에 그대로 보이는데 헤더 버튼에 안 읽은 수가
   * 남아 있으면 거짓말이 된다. `markRead`의 신원이 남의 말 개수에 묶여 있어 새 말이 오면 이
   * effect가 다시 돈다(useRoomChat).
   */
  useEffect(() => {
    markRead()
  }, [markRead])

  return (
    <button
      aria-label={chatLabel(chat.unread)}
      className={cn(
        'flex cursor-pointer flex-col gap-1 rounded-card border border-border/60 bg-surface/75 px-2.5 py-2 text-left backdrop-blur-sm transition-colors hover:bg-surface/90 focus-ring',
        className,
      )}
      onClick={onOpen}
      type="button"
    >
      {recent.length === 0 ? (
        <span className="text-2xs text-content-faint">메시지 입력</span>
      ) : (
        <span aria-hidden="true" className="grid grid-cols-1 gap-0.5">
          {recent.map((line) => (
            <span className="flex min-w-0 items-baseline gap-1.5 text-2xs" key={line.messageId}>
              <span className="max-w-16 flex-none truncate font-semibold text-content-faint">
                {line.playerId === you ? '나' : line.nickname}
              </span>
              <span className="min-w-0 flex-1 truncate text-content">{line.text}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  )
}
