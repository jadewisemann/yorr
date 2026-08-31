import { cn } from '@/shared/cn'
import type { PlayerId } from '../wsEvents'
import { ChatBody } from './ChatBody'
import type { RoomChat } from './useRoomChat'

interface ChatPanelProps {
  chat: RoomChat
  className?: string | undefined
  you: PlayerId
}

/**
 * 화면에 **상주하는** 채팅 패널. 판 위 오버레이(`ChatOverlay`)와 달리 열고 닫지 않으므로
 * 안 읽은 수를 세어 보여 줄 이유가 없다 — 보이는 동안 늘 읽음이다(`ChatBody`의 `active`가
 * 항상 true).
 *
 * 높이는 **호출부가 정한다.** 대기실은 참가자 목록과 남는 높이를 나눠 갖고, 넓은 화면에서는
 * 오른쪽 열이 되어 화면 높이를 통째로 쓴다. 그래서 여기서는 `min-h-0`만 지키고 자체 상한을
 * 두지 않는다 — 패널이 스스로 높이를 정하면 어느 화면에서든 한 쪽이 어긋난다.
 */
export function ChatPanel({ chat, className, you }: ChatPanelProps) {
  return (
    <section
      aria-label="채팅"
      className={cn(
        'flex min-h-0 flex-col gap-2 rounded-panel border border-border bg-surface-raised p-3',
        className,
      )}
    >
      {/*
       * 좁은 화면에서는 제목을 눈에서 지운다 — 패널 높이가 고정이라 제목 한 줄이 곧 대화 한
       * 줄이고, 말풍선과 입력칸이 있는 자리가 채팅임은 보면 안다. 스크린리더에는 section의
       * aria-label과 이 제목이 그대로 남는다.
       */}
      <h2 className="sr-only m-0 flex-none text-sm font-bold lg:not-sr-only">채팅</h2>
      <ChatBody active chat={chat} className="flex-1" listClassName="min-h-0 flex-1" you={you} />
    </section>
  )
}
