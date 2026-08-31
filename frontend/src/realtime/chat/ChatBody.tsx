import { type FormEvent, useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { CHAT_TEXT_MAX_LENGTH, type PlayerId } from '../wsEvents'
import type { RoomChat } from './useRoomChat'

interface ChatBodyProps {
  /** 화면에 보이는 동안만 true. 창은 열림 여부이고, 상주 패널은 늘 true다. */
  active: boolean
  chat: RoomChat
  className?: string | undefined
  /** 대화 목록의 높이 정책. 창은 상한을 두고, 상주 패널은 남는 높이를 채운다. */
  listClassName?: string | undefined
  you: PlayerId
}

const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' })

/**
 * 대화 목록과 입력칸. 창(`ChatDialog`)과 상주 패널(`ChatPanel`)이 이것을 공유한다 —
 * 읽음 처리·마지막 줄 따라가기·거절 처리가 두 형태에서 같아야 하기 때문이다.
 * 다른 것은 **높이 정책과 껍데기**뿐이라 그 둘만 prop으로 받는다.
 */
export function ChatBody({ active, chat, className, listClassName, you }: ChatBodyProps) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const { lines, markRead, send } = chat

  /*
   * 보이는 동안은 계속 읽음으로 둔다. `markRead`의 신원이 남의 말 개수에 묶여 있어
   * (useRoomChat) 새 말이 오면 이 effect가 다시 돈다 — 줄 수를 따로 의존성에 넣지 않아도 된다.
   */
  useEffect(() => {
    if (!active) return
    markRead()
  }, [markRead, active])

  useEffect(() => {
    // 새 말은 아래에 쌓인다 — 보이는 동안은 마지막 줄을 따라간다.
    // jsdom에는 scrollIntoView가 없다 — 따라가지 못하는 것은 화면 밖 환경이라 문제가 아니다.
    if (!active || lines.length === 0) return
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [lines, active])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
    setDraft('')
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      {/*
       * grid-cols-1(= minmax(0, 1fr))이 있어야 한다. 열을 정의하지 않으면 암시적 열이 auto라서
       * 한 줄의 max-w-[85%]가 순환 참조로 무력화되고, 긴 말이 max-content 폭을 요구해 열이
       * 컨테이너보다 넓어진다 — 그러면 justify-self-end인 내 말풍선이 스크롤 영역 밖으로 밀려
       * 잘리고 가로 스크롤바가 생긴다.
       */}
      <div
        aria-label="대화 내용"
        aria-live="polite"
        className={cn(
          'grid auto-rows-min grid-cols-1 gap-2 overflow-y-auto overscroll-contain',
          listClassName,
        )}
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
    </div>
  )
}

function ChatLineRow({ line, you }: { line: RoomChat['lines'][number]; you: PlayerId }) {
  const mine = line.playerId === you

  return (
    <p
      className={cn(
        'm-0 grid max-w-[85%] grid-cols-1 gap-0.5',
        mine ? 'justify-self-end' : 'justify-self-start',
      )}
    >
      <span
        className={cn(
          'flex items-baseline gap-2 text-2xs font-semibold text-content-faint',
          mine && 'justify-end',
        )}
      >
        <span className="min-w-0 truncate">{mine ? '나' : line.nickname}</span>
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
