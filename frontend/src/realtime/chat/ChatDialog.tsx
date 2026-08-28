import { type FormEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Button } from '@/shared/components/Button'
import { Popover, PopoverHeader } from '@/shared/components/Popover'
import { CHAT_TEXT_MAX_LENGTH, type PlayerId } from '../wsEvents'
import type { RoomChat } from './useRoomChat'

interface ChatDialogProps {
  anchorRef?: RefObject<HTMLElement | null> | undefined
  chat: RoomChat
  layout: 'narrow' | 'wide'
  onClose: () => void
  open: boolean
  you: PlayerId
}

const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' })

/**
 * 방 채팅 창. 좁은 화면은 바텀시트, 넓은 화면은 앵커 팝오버다(`AccountDialog`와 같은 갈래) —
 * 폰에서 팝오버를 띄우면 키보드가 올라올 때 입력칸이 화면 밖으로 밀린다.
 *
 * 대화 목록·입력칸의 상태만 여기 있고, 여는 버튼은 화면마다 생김새가 달라
 * **호스트 화면이 각자 그린다**(대기실은 `Button`, 게임 헤더는 `HeaderButton`).
 */
export function ChatDialog({ anchorRef, chat, layout, onClose, open, you }: ChatDialogProps) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const { lines, markRead, send } = chat

  /*
   * 열려 있는 동안은 계속 읽음으로 둔다. `markRead`의 신원이 남의 말 개수에 묶여 있어
   * (useRoomChat) 새 말이 오면 이 effect가 다시 돈다 — 줄 수를 따로 의존성에 넣지 않아도 된다.
   */
  useEffect(() => {
    if (!open) return
    markRead()
  }, [markRead, open])

  useEffect(() => {
    // 새 말은 아래에 쌓인다 — 열려 있는 동안은 마지막 줄을 따라간다.
    // jsdom에는 scrollIntoView가 없다 — 따라가지 못하는 것은 화면 밖 환경이라 문제가 아니다.
    if (!open || lines.length === 0) return
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [lines, open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
    setDraft('')
  }

  const body = (
    <>
      <div
        aria-label="대화 내용"
        aria-live="polite"
        className="grid max-h-64 min-h-32 auto-rows-min gap-2 overflow-y-auto overscroll-contain"
        role="log"
      >
        {lines.length === 0 ? (
          <p className="m-0 self-center text-center text-sm text-content-faint">
            아직 대화가 없어요. 먼저 말을 걸어 보세요.
          </p>
        ) : (
          lines.map((line) => <ChatLineRow key={line.messageId} line={line} you={you} />)
        )}
        <div ref={endRef} />
      </div>

      <form className="flex flex-none items-end gap-2" onSubmit={submit}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">보낼 메시지</span>
          <input
            autoComplete="off"
            className="min-h-12 w-full rounded-card border border-border bg-surface px-3.5 text-base text-content outline-none transition-[border-color,box-shadow] placeholder:text-content-faint focus-visible:border-focus focus-visible:ring-4 focus-visible:ring-focus/10"
            enterKeyHint="send"
            maxLength={CHAT_TEXT_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="메시지 입력"
            value={draft}
          />
        </label>
        <Button
          className="min-h-12 flex-none px-4"
          disabled={draft.trim().length === 0}
          type="submit"
        >
          보내기
        </Button>
      </form>
    </>
  )

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
      <div className="mt-2 grid gap-3">{body}</div>
    </Popover>
  )
}

function ChatLineRow({ line, you }: { line: RoomChat['lines'][number]; you: PlayerId }) {
  const mine = line.playerId === you

  return (
    <p
      className={cn(
        'm-0 grid max-w-[85%] gap-0.5',
        mine ? 'justify-self-end' : 'justify-self-start',
      )}
    >
      <span
        className={cn(
          'flex items-baseline gap-2 text-2xs font-semibold text-content-faint',
          mine && 'justify-end',
        )}
      >
        <span className="truncate">{mine ? '나' : line.nickname}</span>
        <span className="flex-none tabular-nums">{timeFormat.format(line.at)}</span>
      </span>
      <span
        className={cn(
          'rounded-card px-3 py-2 text-sm/[1.45] break-words whitespace-pre-wrap',
          mine ? 'bg-brand/15 text-content' : 'bg-surface text-content',
        )}
      >
        {line.text}
      </span>
    </p>
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
