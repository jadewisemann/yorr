import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type Player, type ReactionType } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'

/**
 * 계약(`wsEvents.ts`)의 `ReactionType` 5종 ↔ 화면 이모지. 배열 순서가 픽커에 놓이는 순서다.
 * 이모지는 화면에만 살고 와이어에는 `type` 문자열만 흐른다 — 서버는 이 표를 모른다.
 */
const REACTIONS = [
  { emoji: '👍', label: '좋아요', type: 'like' },
  { emoji: '😂', label: '웃겨요', type: 'laugh' },
  { emoji: '😱', label: '놀랐어요', type: 'shock' },
  { emoji: '👏', label: '박수', type: 'clap' },
  { emoji: '🫡', label: 'GG', type: 'gg' },
] as const satisfies ReadonlyArray<{ emoji: string; label: string; type: ReactionType }>

/** tokens.css의 `--animate-reaction-float` 지속시간과 같은 값. */
const FLIGHT_MS = 2_200
/** 동시에 떠 있을 수 있는 개수. 6명이 연타해도 화면이 이모지로 덮이지 않게 한다. */
const MAX_FLYING = 12
/**
 * 항목마다 돌려 쓰는 좌우 흩뿌림. Math.random 대신 id로 고르면 테스트도 같은 그림을 본다.
 *
 * ponytail: motion-reduce에서 같은 순간에 3개 이상 도착하면 닉네임 필이 겹친다(2.2초).
 * 날아가는 동안 자연히 흩어지는 애니메이션이 없어서다. 세로 stagger를 주려면 항목마다
 * custom property가 하나 더 필요한데, 낭독은 live region이 이미 하고 있어 그만큼의
 * 값은 아니다. 실제로 겹쳐서 못 읽겠다는 얘기가 나오면 그때 세로 오프셋을 추가한다.
 */
const DRIFTS = ['-1.5rem', '-0.6rem', '0.2rem', '0.9rem', '1.6rem']

interface Flying {
  emoji: string
  id: number
  /** 낭독용 이름. 계약에 없는 reaction이 오면 빈 문자열이다. */
  label: string
  nickname: string
}

interface ReactionDockProps {
  className?: string
  /** 닉네임을 붙여 "누가 보냈는지" 읽히게 한다. */
  players: Player[]
}

/**
 * 이모지 리액션 — 버튼 하나를 눌러 펼치고, 고른 이모지가 방 전원의 화면에서 솟아오른다.
 * <p>
 * 전송은 `reaction.send`, 수신은 `reaction.broadcast`로 이미 서버에 구현돼 있다
 * (`GameWebSocketHandler.handleReactionSend`). 서버는 보낸 본인에게도 되돌려주므로
 * 내가 누른 이모지도 남과 같은 경로로 뜬다 — 낙관적 렌더링을 따로 두지 않는다.
 * <p>
 * 뜬 이모지는 휘발성 연출이라 전역 store에 넣지 않고 여기서 소켓을 직접 구독한다.
 */
export function ReactionDock({ className, players }: ReactionDockProps) {
  const client = useRealtimeClient()
  const pickerId = useId()
  const [open, setOpen] = useState(false)
  const [flying, setFlying] = useState<Flying[]>([])
  // players는 점수·presence 갱신마다 새 배열로 온다. 구독 effect의 deps에 넣으면
  // 그때마다 재구독하므로 최신 값만 ref로 넘긴다.
  const playersRef = useRef(players)
  playersRef.current = players
  const nextIdRef = useRef(0)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const unsubscribe = client.onMessage((message) => {
      if (message.type !== 'reaction.broadcast') return
      const { playerId, reaction } = message.payload
      const id = nextIdRef.current++
      // 서버가 계약에 없는 reaction을 보낼 수 있다(FE보다 먼저 종류가 늘어난 경우).
      // 알 수 없는 값이면 말풍선으로 떨어뜨린다 — 리액션 하나 때문에 화면이 죽으면 안 된다.
      const known = REACTIONS.find((candidate) => candidate.type === reaction)
      setFlying((current) => [
        // 연타로 화면이 덮이지 않게 오래된 것부터 버린다.
        ...current.slice(-(MAX_FLYING - 1)),
        {
          emoji: known?.emoji ?? '💬',
          id,
          label: known?.label ?? '',
          nickname:
            playersRef.current.find((player) => player.playerId === playerId)?.nickname ?? '',
        },
      ])
      // animationend에 걸면 prefers-reduced-motion에서 이벤트가 오지 않아 영원히 쌓인다.
      timers.add(
        setTimeout(
          () => setFlying((current) => current.filter((item) => item.id !== id)),
          FLIGHT_MS,
        ),
      )
    })

    return () => {
      unsubscribe()
      for (const timer of timers) clearTimeout(timer)
    }
  }, [client])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const send = (reaction: ReactionType) => {
    setOpen(false)
    try {
      client.send(buildClientMessage('reaction.send', { reaction }))
    } catch {
      // 소켓이 끊긴 동안의 리액션은 조용히 버린다 — 재전송할 가치가 없는 연출이고,
      // 연결이 끊겼다는 사실은 ConnectionBanner가 이미 말하고 있다.
    }
  }

  const latest = flying.at(-1)

  return (
    <div className={cn('relative flex-none', className)}>
      {/* 떠오르는 이모지는 장식이라 aria-hidden이고, 낭독은 이 줄이 대신한다
          (6명이 연타할 때 이모지마다 읽히면 소음이 된다 — polite로 최신 하나만). */}
      <p aria-live="polite" className="sr-only" role="status">
        {latest ? `${latest.nickname} ${latest.label}` : ''}
      </p>

      {flying.map((item) => (
        <span
          aria-hidden="true"
          // bottom-full: 버튼 바로 위에서 출발한다. w-tap + items-center로 버튼 중심에 정렬.
          // motion-reduce에서는 제자리에 뜬 채로 FLIGHT_MS 뒤 사라진다 — "누가 리액션을
          // 보냈다"는 정보는 남기고 움직임만 뺀다(RollResultCallout과 같은 처리).
          // translate-x-(--drift): 애니메이션이 도는 동안은 keyframe의 transform이 이겨서
          // 무시되고, motion-reduce로 애니메이션이 없을 때만 적용된다 — 그래야 동시에 온
          // 리액션이 한 점에 겹쳐 하나처럼 보이지 않는다.
          className="pointer-events-none absolute right-0 bottom-full flex w-tap translate-x-(--drift) flex-col items-center gap-1 animate-reaction-float motion-reduce:animate-none"
          key={item.id}
          style={{ '--drift': DRIFTS[item.id % DRIFTS.length] } as CSSProperties}
        >
          <span className="text-[30px] leading-none drop-shadow-[0_2px_10px_rgb(0_0_0_/_60%)]">
            {item.emoji}
          </span>
          {item.nickname && (
            <span className="max-w-24 truncate rounded-full bg-surface-overlay/90 px-1.5 py-px text-[10px] font-semibold whitespace-nowrap text-content-muted">
              {item.nickname}
            </span>
          )}
        </span>
      ))}

      {/* 픽커는 항상 마운트해두고 열림/닫힘만 전환한다 — 마운트/언마운트가 아니라 상태
          전환이라 CSS transition으로 충분하다(motion은 진입·퇴장용). absolute로 띄워
          닫혔을 때 버튼을 아래로 밀지 않게 한다. */}
      <div
        className={cn(
          'absolute right-0 bottom-full mb-2 flex gap-0.5 rounded-panel border border-border bg-surface-overlay/95 p-1 shadow-raised transition-all duration-(--ds-motion-fast) ease-snappy',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
        )}
        id={pickerId}
        style={{ transformOrigin: 'bottom right' }}
      >
        {REACTIONS.map((reaction) => (
          <button
            aria-label={reaction.label}
            className="grid size-11 cursor-pointer place-items-center rounded-card border-0 bg-transparent p-0 text-[22px] leading-none transition-transform hover:scale-115 focus-visible:outline-3 focus-visible:outline-focus"
            key={reaction.type}
            onClick={() => send(reaction.type)}
            // 닫힌 픽커가 탭 순서에 남으면 포커스가 보이지 않는 곳으로 들어간다.
            tabIndex={open ? undefined : -1}
            type="button"
          >
            <span aria-hidden="true">{reaction.emoji}</span>
          </button>
        ))}
      </div>

      <button
        aria-controls={pickerId}
        aria-expanded={open}
        aria-label="리액션 보내기"
        className={cn(
          'grid size-tap cursor-pointer place-items-center rounded-card border border-border bg-surface/90 text-[19px] shadow-raised transition-colors focus-visible:outline-3 focus-visible:outline-focus',
          open && 'border-brand bg-brand/15',
        )}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {/* 픽커 5종과 겹치지 않는 글리프여야 한다 — 🙂는 🫡와 나란히 놓으면 같은 얼굴로 읽힌다. */}
        <span aria-hidden="true">💬</span>
      </button>
    </div>
  )
}
