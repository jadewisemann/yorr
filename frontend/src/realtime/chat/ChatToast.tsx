import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { ENTER, EXIT } from '@/shared/motion'
import type { PlayerId } from '../wsEvents'
import { ChatLineRow } from './ChatBody'
import type { ChatLine, RoomChat } from './useRoomChat'

interface ChatToastProps {
  chat: RoomChat
  className?: string | undefined
  /** 말풍선을 눌렀을 때 지난 대화와 입력칸이 있는 시트를 연다. */
  onOpen: () => void
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

/**
 * 게임판 위에 **새 말만 잠깐 띄우는** 알림. 대화를 상주시키면 주사위 판을 계속 가리고,
 * 창을 열어야만 보이면 굴리는 중에 오간 말을 놓친다 — 그 사이가 이 컴포넌트다.
 *
 * 말풍선 모양은 시트 안 목록과 **같다**(`ChatLineRow`). 그래서 떠 있는 말을 그대로 눌러
 * 시트를 열면 방금 본 말풍선이 이어져 보이고, 토스트가 대화로 들어가는 입구가 된다.
 * 헤더의 채팅 버튼도 같은 시트를 연다 — 토스트가 이미 사라진 뒤의 경로다.
 *
 * 여기서는 **읽음 처리를 하지 않는다**: 떠 있는 4초를 놓친 사람에게는 안 읽은 말이 맞고,
 * 그 수를 헤더 배지가 들고 있어야 한다.
 *
 * 마운트 시점에 이미 쌓여 있던 줄은 띄우지 않는다 — 대기실에서 나눈 대화가 게임이 시작되는
 * 순간 한꺼번에 떠오르면 판을 덮는다.
 */
export function ChatToast({ chat, className, onOpen, you }: ChatToastProps) {
  const { lines } = chat
  const [pending, setPending] = useState<Pending[]>([])
  const seenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
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

  return (
    <div
      aria-live="polite"
      className={cn('pointer-events-none grid grid-cols-1 gap-1.5', className)}
      role="status"
    >
      <AnimatePresence initial={false}>
        {/*
         * 말풍선 뒤에 깔리는 백드롭. 말풍선만으로는 주사위 판의 밝은 연출·굴러다니는 주사위와
         * 경계가 흐려진다 — 그 자리를 캔버스 색으로 덮고 살짝 흐려서 대화가 얹힌 자리임을
         * 한눈에 알게 한다. 위아래 **양쪽으로** 사라지게 하는 이유: 위를 딱 끊으면 바로 위
         * 트레이 툴바(흔들기·남은 굴림)와 경계선이 생겨 툴바가 잘려 보인다.
         * 말이 사라지면 백드롭도 함께 걷힌다.
         */}
        {pending.length > 0 && (
          <motion.div
            animate={{ opacity: 1 }}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-3 -top-3 -bottom-10 -z-10 bg-[linear-gradient(to_bottom,transparent_0%,var(--color-canvas)_14%,color-mix(in_oklab,var(--color-canvas)_72%,transparent)_58%,transparent_100%)] backdrop-blur-[3px]"
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
             * 주사위를 눌러 굴릴 수 없다. 키보드·스크린리더는 헤더의 채팅 버튼으로 같은 시트를
             * 열므로 이 탭은 포인터 사용자용 지름길이다.
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
              onClick={onOpen}
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
