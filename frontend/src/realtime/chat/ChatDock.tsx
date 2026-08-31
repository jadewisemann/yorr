import { useEffect, useEffectEvent } from 'react'
import { cn } from '@/shared/cn'
import type { PlayerId } from '../wsEvents'
import { ChatBody } from './ChatBody'
import type { RoomChat } from './useRoomChat'

interface ChatDockProps {
  chat: RoomChat
  className?: string | undefined
  onToggle: (open: boolean) => void
  open: boolean
  you: PlayerId
}

/** 접었을 때 보여 줄 줄 수. 더 쌓으면 뒤 화면을 가리고, 한 줄이면 오간 흐름이 안 읽힌다. */
const PEEK_LINES = 3

/**
 * 좁은 화면의 채팅 자리 — **화면 위쪽에 늘 떠 있고, 눌러서 폈다 접는다.**
 *
 * 왜 화면 흐름이 아니라 떠 있나: 대기실이든 게임판이든 폰 세로에 채팅 몫으로 떼어 줄 높이가
 * 없다. 대기실에서 아래를 고정으로 물면 참가자 목록과 시작 버튼이 밀리고, 게임판은 굴리기
 * 푸터·기록 패널·리액션 독이 이미 아래를 층층이 쓴다. 위쪽은 두 화면 모두 비어 있다.
 *
 * 왜 아래가 아니라 위인가: 편 상태의 입력칸이 화면 위쪽에 있으면 키보드가 올라와도 가리지
 * 않는다 — 바텀시트를 쓰던 때 이 문제를 피하려 애쓰던 자리다.
 *
 * 접힌 상태의 대화는 스크린리더에 **읽히지 않는다** — 편 상태의 `role="log"`가 같은 말을
 * 이미 읽어 주므로 여기서 또 읽으면 새 말마다 두 번 들린다.
 *
 * 안 읽은 수를 세지 않는 이유도 같다: 접혀 있어도 최근 줄이 그대로 보이므로 늘 읽음이다.
 */
export function ChatDock({ chat, className, onToggle, open, you }: ChatDockProps) {
  const recent = chat.lines.slice(-PEEK_LINES)
  const close = useEffectEvent(() => onToggle(false))

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  /*
   * 접힘·펼침 모두 **불투명**이다. 반투명으로 두면 대기실 참가자 카드나 게임판의 "내 차례!"
   * 문구가 대화 위로 비쳐서 둘 다 못 읽는다 — 얹히는 자리가 늘 뭔가의 위다.
   */
  const shell = 'rounded-card border border-border/60 transition-colors'

  if (!open) {
    return (
      <button
        aria-expanded={false}
        aria-label="채팅 열기"
        className={cn(
          shell,
          'flex w-full cursor-pointer flex-col gap-0.5 bg-surface px-2.5 py-2 text-left shadow-raised hover:bg-surface-raised focus-ring',
          className,
        )}
        onClick={() => onToggle(true)}
        type="button"
      >
        {recent.length === 0 ? (
          <span className="text-2xs text-content-faint">눌러서 대화하기</span>
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

  return (
    <section
      aria-label="채팅"
      className={cn(shell, 'flex flex-col gap-2 bg-surface-raised p-3 shadow-overlay', className)}
    >
      <div className="flex flex-none items-baseline justify-between gap-3">
        <h2 className="m-0 text-sm font-bold">채팅</h2>
        <button
          aria-expanded
          className="-my-2 -mr-1 inline-flex min-h-tap cursor-pointer items-center border-0 bg-transparent px-1 text-xs font-semibold text-content-muted transition-colors hover:text-content focus-ring focus-visible:outline-offset-2"
          onClick={() => onToggle(false)}
          type="button"
        >
          접기
        </button>
      </div>
      <ChatBody active chat={chat} listClassName="max-h-[38svh] min-h-32" you={you} />
    </section>
  )
}
