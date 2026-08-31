import { BottomSheet } from '@/shared/components/BottomSheet'
import type { PlayerId } from '../wsEvents'
import { ChatBody } from './ChatBody'
import type { RoomChat } from './useRoomChat'

interface ChatDialogProps {
  chat: RoomChat
  onClose: () => void
  open: boolean
  you: PlayerId
}

/** 시트 안에서 대화 목록이 차지할 높이. 상주 패널(`ChatPanel`)은 남는 높이를 대신 채운다. */
const SHEET_LIST_HEIGHT = 'max-h-64 min-h-32'

/**
 * 방 채팅 **입력 시트**. 남은 자리는 좁은 화면 게임판 하나다 — 거기서는 대화가
 * `ChatOverlay`로 판 위에 상주하고, 말을 쓸 때만 이 시트를 올린다.
 *
 * 팝오버가 아니라 바텀시트인 이유: 폰에서 팝오버를 띄우면 키보드가 올라올 때 입력칸이 화면
 * 밖으로 밀린다. (넓은 화면에는 이 시트를 쓰는 곳이 없다 — 거기서는 채팅이 오른쪽 열에
 * 통째로 상주한다.)
 *
 * 여는 버튼은 게임 헤더가 `HeaderButton`으로 직접 그린다 — 창만 공유하고 트리거를 넘기지
 * 않는 것이 `AudioPopover`와 같은 갈래다.
 */
export function ChatDialog({ chat, onClose, open, you }: ChatDialogProps) {
  return (
    <BottomSheet
      className="h-auto gap-3 bg-surface-raised pb-[max(24px,env(safe-area-inset-bottom))]"
      onClose={onClose}
      open={open}
      title="채팅"
    >
      <ChatBody active={open} chat={chat} listClassName={SHEET_LIST_HEIGHT} you={you} />
    </BottomSheet>
  )
}

export function chatLabel(unread: number) {
  return unread > 0 ? `채팅 · 읽지 않은 메시지 ${unread}개` : '채팅'
}

/**
 * 여는 버튼 위에 겹치는 안 읽은 수. 버튼은 화면마다 다르지만 이 표시는 같아야 해서
 * 여기 둔다 — 개수는 `aria-label`(위 `chatLabel`)이 읽어 주므로 시각 표시만 맡는다.
 */
export function ChatUnreadBadge({ count }: { count: number }) {
  if (count === 0) return null

  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 grid min-w-4.5 place-items-center rounded-full bg-brand px-1 text-2xs/[1.1] font-bold text-on-brand tabular-nums"
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}
