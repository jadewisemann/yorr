import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type Player, type ReactionType } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { resolveRovingKey } from '@/shared/rovingFocus'

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
 * <p>
 * <b>0 이하만 쓴다 — 독은 화면 오른쪽 끝에 붙어 있다.</b> 양수 drift는 이모지와 닉네임 필을
 * 뷰포트 밖으로 밀어낸다(320px에서 실측: 필이 오른쪽에서 잘려 누가 보냈는지 못 읽었다).
 * 왼쪽은 트레이 안쪽이라 얼마든지 흩어져도 된다.
 */
const DRIFTS = ['-3.2rem', '-2.4rem', '-1.5rem', '-0.7rem', '0rem']

/**
 * 세로 흩뿌림. 좌우만 흔들면 같은 순간에 도착한 것들이 <b>같은 높이에서 나란히</b> 올라가
 * 한 줄로 읽히고, motion-reduce에서는 제자리에 뜨는 닉네임 필이 그대로 겹친다.
 * <p>
 * <b>길이를 {@link DRIFTS}와 서로소로 둔다</b>(5 × 3). 같은 길이면 두 값이 같은 주기로 돌아
 * 조합이 5가지뿐인데, 서로소면 15가지가 돌아가서 연타해도 같은 자리가 겹치지 않는다.
 * 정확히 15개를 넘겨야 반복되므로 {@link MAX_FLYING}(12)보다 크다 — 화면에 함께 떠 있는
 * 것들끼리는 절대 같은 좌표를 쓰지 않는다.
 */
const LIFTS = ['0rem', '-1.15rem', '-2.3rem']

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
  const dockRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const chipsRef = useRef<(HTMLButtonElement | null)[]>([])
  /** roving tabindex의 현재 위치. 픽커를 열면 늘 첫 칸부터 시작한다. */
  const [focusedChip, setFocusedChip] = useState(0)
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

  /**
   * Escape로 닫고 트리거로 포커스를 돌린다. 픽커 안에서 Escape를 눌렀을 때 포커스가
   * 사라진 요소에 남으면 다음 Tab이 문서 처음으로 튄다.
   */
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true)
    }
    // 바깥을 누르면 닫는다. 랜딩의 랭킹 드롭다운과 같은 규칙이다 — 리액션 픽커도 모달이
    // 아니므로 뒤를 잠그지 않고, 열어 둔 채 다른 곳을 누르면 그대로 닫히기만 한다.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && dockRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [close, open])

  // 열면 첫 칸에 포커스를 준다. 픽커가 DOM에서 트리거보다 **앞**에 있어(닫혔을 때 버튼을
  // 아래로 밀지 않으려고 absolute로 띄운 결과) Tab을 앞으로 눌러서는 칸에 도달할 수 없었다.
  useEffect(() => {
    if (!open) return
    setFocusedChip(0)
    chipsRef.current[0]?.focus()
  }, [open])

  /**
   * 리액션을 보낸다. <b>보낸 뒤에도 픽커를 닫지 않는다.</b> 리액션은 대화가 아니라 환호라서
   * 연달아 누르는 것이 기본 사용법인데, 매번 닫히면 세 번 보내려고 픽커를 세 번 열어야 했다.
   * 닫는 것은 Escape · 바깥 누르기 · 트리거 다시 누르기가 맡는다.
   */
  const send = (reaction: ReactionType) => {
    try {
      client.send(buildClientMessage('reaction.send', { reaction }))
    } catch {
      // 소켓이 끊긴 동안의 리액션은 조용히 버린다 — 재전송할 가치가 없는 연출이고,
      // 연결이 끊겼다는 사실은 ConnectionBanner가 이미 말하고 있다.
    }
  }

  /** 방향키로 칸 사이를 옮긴다(WAI-ARIA toolbar). Tab은 픽커 전체를 한 칸으로 지나간다. */
  const handleChipKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = resolveRovingKey(event.key, focusedChip, REACTIONS.length)
    if (next === null) return
    event.preventDefault()
    setFocusedChip(next)
    chipsRef.current[next]?.focus()
  }

  const latest = flying.at(-1)

  return (
    <div className={cn('relative flex-none', className)} ref={dockRef}>
      {/* 떠오르는 이모지는 장식이라 aria-hidden이고, 낭독은 이 줄이 대신한다
          (6명이 연타할 때 이모지마다 읽히면 소음이 된다 — polite로 최신 하나만). */}
      <p aria-live="polite" className="sr-only" role="status">
        {latest ? `${latest.nickname} ${latest.label}` : ''}
      </p>

      {flying.map((item) => (
        <span
          aria-hidden="true"
          // bottom-full: 버튼 바로 위에서 출발한다. w-tap + items-center로 버튼 중심에 정렬.
          // 이 위쪽 통로는 비워 둔다 — 픽커를 여기(bottom-full)에 두었을 때 막 보낸 이모지가
          // 그 판 뒤에서 떠올라, 연달아 눌러도 아무 일도 일어나지 않는 것처럼 보였다.
          // 그래서 픽커는 트리거 왼쪽(right-full)으로 비켰다.
          // motion-reduce에서는 제자리에 뜬 채로 FLIGHT_MS 뒤 사라진다 — "누가 리액션을
          // 보냈다"는 정보는 남기고 움직임만 뺀다(RollResultCallout과 같은 처리).
          // translate-x/y-(--drift/--lift): 애니메이션이 도는 동안은 keyframe의 transform이
          // 이겨서 무시되고, motion-reduce로 애니메이션이 없을 때만 적용된다 — 그래야 동시에
          // 온 리액션이 한 점에 겹쳐 하나처럼 보이지 않는다. 좌우(--drift)만으로는 같은
          // 높이에 한 줄로 서므로 세로(--lift)까지 흔든다.
          // items-end: 닉네임 필(max-w-24)은 버튼(w-tap)보다 넓다 — 가운데 정렬이면 버튼
          // 오른쪽으로 26px 삐져나가고, 독이 화면 오른쪽 끝에 붙어 있으므로 그만큼 뷰포트를
          // 넘어 잘렸다. 오른쪽 끝을 맞추면 넘치는 쪽이 안쪽(왼쪽)으로만 자란다.
          className="pointer-events-none absolute right-0 bottom-full flex w-tap translate-x-(--drift) translate-y-(--lift) flex-col items-end gap-1 animate-reaction-float motion-reduce:animate-none"
          key={item.id}
          style={
            {
              '--drift': DRIFTS[item.id % DRIFTS.length],
              '--lift': LIFTS[item.id % LIFTS.length],
            } as CSSProperties
          }
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
          닫혔을 때 버튼을 아래로 밀지 않게 한다.
          <b>트리거 위가 아니라 옆(right-full)으로 편다.</b> 위에 두면 판이 이모지가 솟는
          자리를 정확히 덮는다 — 날아오르는 첫 구간(-1rem 언저리)이 통째로 판 뒤라 연타해도
          화면이 조용했고, motion-reduce에서는 제자리에 뜨므로 아예 보이지 않았다.
          옆으로 비키면 위쪽 통로가 열려 모바일·데스크톱 모두 누른 즉시 이모지가 보인다.
          독은 화면 오른쪽 끝에 붙어 있으니 왼쪽으로만 자란다 — 지원 하한 320px에서도
          픽커 왼쪽 끝이 37.8px에 선다(실측). 여섯 번째 칸을 늘리기 전에는 이 폭을 다시 잰다. */}
      <div
        aria-label="리액션 고르기"
        aria-orientation="horizontal"
        className={cn(
          'absolute top-1/2 right-full mr-2 flex -translate-y-1/2 gap-0.5 rounded-panel border border-border bg-surface-overlay/95 p-1 shadow-raised transition-all duration-(--ds-motion-fast) ease-snappy',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
        )}
        id={pickerId}
        onKeyDown={handleChipKeyDown}
        // 여러 버튼이 한 덩어리로 움직이는 묶음이다 — toolbar로 알리면 보조기기가 방향키
        // 이동을 예고하고, Tab은 픽커 전체를 한 칸으로 지나간다.
        role="toolbar"
        style={{ transformOrigin: 'right center' }}
      >
        {REACTIONS.map((reaction, index) => (
          <button
            aria-label={reaction.label}
            // active:scale-90 — 리액션은 서버를 한 바퀴 돌아 와야 화면에 뜬다. 그 사이가
            // 무반응으로 읽혀 "눌렸나?" 하고 다시 누르게 된다. 누르는 순간의 응답은 칩이
            // 직접 낸다(전송 성공을 뜻하지 않는다 — 그것은 떠오르는 이모지가 말한다).
            className="reaction-chip focus-ring active:scale-90"
            key={reaction.type}
            onClick={() => send(reaction.type)}
            ref={(element) => {
              chipsRef.current[index] = element
            }}
            // 닫힌 픽커가 탭 순서에 남으면 포커스가 보이지 않는 곳으로 들어간다.
            // 열려 있을 때도 Tab에 걸리는 것은 현재 칸 하나뿐이다(roving tabindex) —
            // 다섯 칸이 각각 Tab을 먹으면 헤더까지 가는 데 다섯 번을 더 눌러야 한다.
            tabIndex={open && index === focusedChip ? 0 : -1}
            type="button"
          >
            {reaction.emoji}
          </button>
        ))}
      </div>

      <button
        aria-controls={pickerId}
        aria-expanded={open}
        aria-label="리액션 보내기"
        className={cn(
          'grid size-tap cursor-pointer place-items-center rounded-card border border-border bg-surface/90 text-[19px] shadow-raised transition-colors focus-ring',
          open && 'border-brand bg-brand/15',
        )}
        onClick={() => (open ? close(false) : setOpen(true))}
        ref={triggerRef}
        type="button"
      >
        {/* 픽커 5종과 겹치지 않는 글리프여야 한다 — 🙂는 🫡와 나란히 놓으면 같은 얼굴로 읽힌다.
            aria-label이 있으니 글리프를 aria-hidden으로 감싸지 않는다 — 이름은 이미 덮인다. */}
        💬
      </button>
    </div>
  )
}
