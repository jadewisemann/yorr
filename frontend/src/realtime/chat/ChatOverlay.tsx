import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { ENTER, EXIT } from '@/shared/motion'
import type { PlayerId } from '../wsEvents'
import { ChatBody, ChatLineRow } from './ChatBody'
import type { ChatLine, RoomChat } from './useRoomChat'

interface ChatOverlayProps {
  chat: RoomChat
  onToggle: (open: boolean) => void
  open: boolean
  /**
   * 접힘 상태의 자리. 펼침은 화면 최상단을 기준으로 스스로 자리를 잡으므로 받지 않는다 —
   * 판 안에 갇히면 헤더와 점수 줄을 못 덮는다.
   */
  peekClassName?: string | undefined
  you: PlayerId
}

/** 한 줄이 떠 있는 시간. 짧으면 놓치고, 길면 판 위에 계속 뭔가 얹혀 있게 된다. */
const LINGER_MS = 4_000

/** 한꺼번에 떠 있을 수 있는 줄 수. 넘치면 오래된 것부터 밀어낸다. */
const MAX_STACK = 3

interface Pending {
  line: ChatLine
  until: number
}

/*
 * 대화가 얹힌 자리를 어둡게 눌러 주는 배경. 말풍선만으로는 굴러다니는 주사위·턴 연출과
 * 경계가 흐려진다.
 *
 * blur가 아니라 **검정 그라데이션**이다: 3D 판 위에서 backdrop-filter는 매 프레임 다시
 * 계산되고, 흐려진 주사위는 "굴러가는 중"과 구별되지 않는다. 위아래 양쪽으로 사라지게 하는
 * 이유는 따로 있다 — 위를 딱 끊으면 바로 위 트레이 툴바(흔들기·남은 굴림)와 경계선이 생겨
 * 툴바가 잘려 보인다.
 */
/**
 * 접힘용 — 몇 줄만 얹히므로 **옅게** 덮는다. 지나가는 알림 때문에 판을 오래 가릴 이유가 없다.
 * 떠오르고 사라지는 말과 함께 페이드해야 해서 별도 레이어로 깐다.
 */
const PEEK_BACKDROP =
  'pointer-events-none absolute -inset-x-3 -top-3 -bottom-12 -z-10 bg-[linear-gradient(to_bottom,rgb(0_0_0/_0%)_0%,rgb(0_0_0/_78%)_14%,rgb(0_0_0/_58%)_58%,rgb(0_0_0/_0%)_100%)]'

/**
 * 펼침용 — 대화를 **읽는** 자리라 그라데이션이 아니라 불투명한 면이고, 아래 모서리와 테두리로
 * 어디까지가 대화인지 선을 긋는다. 조금이라도 비치면 뒤 안내 카드나 점수가 글자 사이로 겹쳐
 * 둘 다 못 읽고, 페이드로 흐려 놓으면 경계가 없어 어디를 눌러야 판인지 모른다.
 *
 * 자리는 **화면 최상단**이고(`fixed`) 크기는 폭 전체 · 높이 62svh 고정이다. 판 안에 갇히면
 * 헤더와 점수 줄이 위에 남아 창이 어중간하게 걸치고, 크기가 대화량을 따라 변하면 열 때마다
 * 다른 것이 뜬 것처럼 보인다. 그동안 게임 정보가 가려지는 것은 **사용자가 채팅을 열어서 고른
 * 결과**다.
 */
const OPEN_PANEL =
  'fixed inset-x-0 top-0 z-sheet h-[62svh] rounded-b-panel border-b border-border bg-surface-overlay px-gutter pt-[max(0.75rem,env(safe-area-inset-top))] pb-4 shadow-overlay'

/**
 * 좁은 화면 게임판 위의 채팅. 판 **위에 얹히기만 하고 껍데기를 두르지 않는다** — 카드나
 * 시트로 감싸면 주사위 판 위에 UI 층이 하나 더 생겨 화면이 무거워진다. 자리를 알려 주는 것은
 * 배경 그라데이션 하나뿐이고, 그 위에 말풍선과 입력칸이 바로 놓인다.
 *
 * 두 모습이 **같은 자리에서 이어진다.**
 * - 접힘: 새 말만 4초 떠 있다 사라진다. 굴리는 중에 오간 말을 놓치지 않으면서 판을 계속
 *   가리지도 않는 사이가 여기다.
 * - 펼침: 지난 대화와 입력칸이 그대로 아래로 이어져 내려온다. 떠 있던 말풍선을 눌러 열면
 *   방금 본 줄이 그 자리에 남아 있어 어디서 온 창인지 눈으로 따라갈 수 있고, 입력칸이 화면
 *   위쪽에 놓여 키보드가 올라와도 가리지 않는다.
 *
 * 접힘 상태에서는 **읽음 처리를 하지 않는다**: 떠 있는 4초를 놓친 사람에게는 안 읽은 말이
 * 맞고, 그 수를 헤더 배지가 들고 있어야 한다. 펼치면 `ChatBody`가 읽음으로 바꾼다.
 *
 * 접힌 대화는 스크린리더에 읽히지 않는다 — 펼친 목록의 `role="log"`가 같은 말을 이미 읽어
 * 주므로 여기서 또 읽으면 새 말마다 두 번 들린다.
 */
export function ChatOverlay({ chat, onToggle, open, peekClassName, you }: ChatOverlayProps) {
  const { lines } = chat
  const [pending, setPending] = useState<Pending[]>([])
  const seenRef = useRef<Set<string> | null>(null)
  const close = useEffectEvent(() => onToggle(false))

  useEffect(() => {
    /*
     * 마운트 시점에 쌓여 있던 줄은 지나간 대화로 본다 — 대기실에서 나눈 말이 게임이 시작되는
     * 순간 한꺼번에 떠오르면 판을 덮는다.
     */
    if (seenRef.current === null) {
      seenRef.current = new Set(lines.map((line) => line.messageId))
      return
    }

    const seen = seenRef.current
    const fresh = lines.filter((line) => !seen.has(line.messageId))
    if (fresh.length === 0) return
    for (const line of fresh) seen.add(line.messageId)

    const until = Date.now() + LINGER_MS
    setPending((current) =>
      [...current, ...fresh.map((line) => ({ line, until }))].slice(-MAX_STACK),
    )
  }, [lines])

  /*
   * 만료는 줄마다 타이머를 거는 대신 **가장 이른 만료 시각 하나**만 재운다. 말이 연달아 오면
   * 타이머가 그만큼 쌓이고, 새 말이 올 때 이전 타이머를 정리하다 먼저 뜬 줄이 안 사라진다.
   */
  useEffect(() => {
    const earliest = pending[0]
    if (!earliest) return
    const timer = setTimeout(
      () => setPending((current) => current.filter((item) => item.until > Date.now())),
      Math.max(0, earliest.until - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [pending])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (open) {
    return (
      <motion.section
        animate={{ opacity: 1, y: 0 }}
        aria-label="채팅"
        className={cn('pointer-events-none flex flex-col gap-2', OPEN_PANEL)}
        initial={{ opacity: 0, y: -10 }}
        transition={ENTER}
      >
        <div className="pointer-events-auto flex flex-none justify-end">
          <button
            className="-my-1 -mr-1 inline-flex min-h-tap cursor-pointer items-center rounded-card border-0 bg-transparent px-2 text-xs font-semibold text-content-muted transition-colors hover:text-content focus-ring focus-visible:outline-offset-2"
            onClick={() => onToggle(false)}
            type="button"
          >
            닫기
          </button>
        </div>
        <ChatBody
          active
          chat={chat}
          className="pointer-events-auto min-h-0 flex-1"
          lineVariant="toast"
          /* 최근 말이 입력칸 바로 위에 오도록 아래부터 채운다 — 대화가 짧아도 위에 붕 뜨지 않는다. */
          listClassName="min-h-0 flex-1 content-end"
          you={you}
        />
      </motion.section>
    )
  }

  return (
    <div
      aria-live="polite"
      className={cn('pointer-events-none top-20 grid grid-cols-1 gap-1.5', peekClassName)}
      role="status"
    >
      <AnimatePresence initial={false}>
        {pending.length > 0 && (
          <motion.div
            animate={{ opacity: 1 }}
            aria-hidden="true"
            className={PEEK_BACKDROP}
            exit={{ opacity: 0, transition: EXIT }}
            initial={{ opacity: 0 }}
            key="backdrop"
            transition={ENTER}
          />
        )}
        {pending.map(({ line }) => {
          const mine = line.playerId === you
          return (
            /*
             * 말줄 폭만큼만(w-fit) pointer-events를 되살린다 — 컨테이너가 판 전체를 덮으면
             * 주사위를 눌러 굴릴 수 없다. 키보드·스크린리더는 헤더의 채팅 버튼으로 같은 대화를
             * 여므로 이 탭은 포인터 사용자용 지름길이다.
             */
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'pointer-events-auto grid w-fit max-w-[85%] cursor-pointer grid-cols-1',
                mine ? 'justify-self-end' : 'justify-self-start',
              )}
              exit={{ opacity: 0, y: -6, transition: EXIT }}
              initial={{ opacity: 0, y: -6 }}
              key={line.messageId}
              onClick={() => onToggle(true)}
              transition={ENTER}
            >
              <ChatLineRow className="max-w-full" line={line} variant="toast" you={you} />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
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
