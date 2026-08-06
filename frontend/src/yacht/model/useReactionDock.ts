import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type Player, type ReactionType } from '@/realtime/wsEvents'
import { resolveRovingKey } from '@/shared/rovingFocus'
import { FLIGHT_MS, type Flying, MAX_FLYING, REACTIONS } from '@/yacht/domain/reactions'

/**
 * 리액션 독의 상태 — 픽커 열림, 떠오르는 이모지 목록, roving focus, 전송.
 *
 * 뜬 이모지는 휘발성 연출이라 전역 store 에 넣지 않고 여기서 소켓을 직접 구독한다.
 * 내가 누른 것도 남과 같은 경로로 뜬다 — 낙관적 렌더링을 따로 두지 않는다.
 */
export function useReactionDock(players: Player[]) {
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

  return {
    chipsRef,
    close,
    dockRef,
    flying,
    focusedChip,
    handleChipKeyDown,
    open,
    pickerId,
    send,
    setOpen,
    triggerRef,
  }
}
