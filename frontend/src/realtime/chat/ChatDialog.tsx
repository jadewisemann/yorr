import type { RefObject } from 'react'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Popover, PopoverHeader } from '@/shared/components/Popover'
import type { PlayerId } from '../wsEvents'
import { ChatBody } from './ChatBody'
import type { RoomChat } from './useRoomChat'

interface ChatDialogProps {
  anchorRef?: RefObject<HTMLElement | null> | undefined
  chat: RoomChat
  layout: 'narrow' | 'wide'
  onClose: () => void
  open: boolean
  you: PlayerId
}

/** 창 안에서 대화 목록이 차지할 높이. 상주 패널(`ChatPanel`)은 남는 높이를 대신 채운다. */
const DIALOG_LIST_HEIGHT = 'max-h-64 min-h-32'

/**
 * 방 채팅 **창**. 좁은 화면은 바텀시트, 넓은 화면은 앵커 팝오버다(`AccountDialog`와 같은 갈래) —
 * 폰에서 팝오버를 띄우면 키보드가 올라올 때 입력칸이 화면 밖으로 밀린다.
 *
 * 대기실은 이 창을 쓰지 않고 `ChatPanel`을 화면에 상주시킨다 — 지금 이 창을 쓰는 곳은
 * 게임 화면뿐이다(주사위 판을 가리지 않아야 해서 여전히 띄우고 닫는다).
 *
 * 여는 버튼은 화면마다 생김새가 달라 **호스트 화면이 각자 그린다**(게임 헤더는 `HeaderButton`).
 */
export function ChatDialog({ anchorRef, chat, layout, onClose, open, you }: ChatDialogProps) {
  const body = <ChatBody active={open} chat={chat} listClassName={DIALOG_LIST_HEIGHT} you={you} />

  if (layout === 'narrow') {
    return (
      <BottomSheet
        className="h-auto gap-3 bg-surface-raised pb-[max(24px,env(safe-area-inset-bottom))]"
        onClose={onClose}
        open={open}
        title="채팅"
      >
        {body}
      </BottomSheet>
    )
  }

  return (
    <Popover anchorRef={anchorRef} label="채팅" onClose={onClose} open={open} width={340}>
      <PopoverHeader onClose={onClose}>채팅</PopoverHeader>
      <div className="mt-2">{body}</div>
    </Popover>
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
