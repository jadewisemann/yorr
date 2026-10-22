import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type Player, type ReactionType } from '@/realtime/wsEvents'
import { resolveRovingKey } from '@/shared/rovingFocus'
import { FLIGHT_MS, type Flying, MAX_FLYING, REACTIONS } from '@/yacht/domain/reactions'

/**
 * 날아가는 리액션 목록. 서버 방송을 받아 하나씩 띄우고 `FLIGHT_MS` 뒤에 걷는다 —
 * 최대 `MAX_FLYING` 개만 남겨 화면이 넘치지 않게 한다.
 */
function useFlyingReactions(players: Player[]) {
  const client = useRealtimeClient()
  const [flying, setFlying] = useState<Flying[]>([])
  const playersRef = useRef(players)
  useLayoutEffect(() => {
    playersRef.current = players
  })
  const nextIdRef = useRef(0)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const unsubscribe = client.onMessage((message) => {
      if (message.type !== 'reaction.broadcast') return
      const { id, item } = describeReaction(
        message.payload,
        playersRef.current,
        nextIdRef.current++,
      )
      setFlying((current) => [...current.slice(-(MAX_FLYING - 1)), item])
      timers.add(
        setTimeout(() => {
          setFlying((current) => current.filter((entry) => entry.id !== id))
        }, FLIGHT_MS),
      )
    })
    return () => {
      unsubscribe()
      for (const timer of timers) clearTimeout(timer)
    }
  }, [client])

  return flying
}

/** 방송 하나를 화면에 띄울 항목으로. 모르는 리액션은 말풍선으로 대신한다. */
function describeReaction(
  payload: { playerId: string; reaction: ReactionType },
  players: Player[],
  id: number,
): { id: number; item: Flying } {
  const known = REACTIONS.find((candidate) => candidate.type === payload.reaction)
  return {
    id,
    item: {
      emoji: known?.emoji ?? '💬',
      id,
      label: known?.label ?? '',
      nickname: players.find((player) => player.playerId === payload.playerId)?.nickname ?? '',
    },
  }
}

/** 열림·닫힘과 포커스 이동. 바깥 클릭·Escape로 닫고, 닫을 때 트리거로 포커스를 돌린다. */
function useDockDisclosure() {
  const [open, setOpen] = useState(false)
  const [focusedChip, setFocusedChip] = useState(0)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const chipsRef = useRef<(HTMLButtonElement | null)[]>([])

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    return bindDismiss({ close, dockRef })
  }, [close, open])

  useEffect(() => {
    if (!open) return
    setFocusedChip(0)
    chipsRef.current[0]?.focus()
  }, [open])

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
    focusedChip,
    handleChipKeyDown,
    open,
    setOpen,
    triggerRef,
  }
}

function bindDismiss(options: {
  close: (restoreFocus: boolean) => void
  dockRef: { current: HTMLDivElement | null }
}) {
  const { close, dockRef } = options
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close(true)
  }
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
}

export function useReactionDock(players: Player[]) {
  const client = useRealtimeClient()
  const pickerId = useId()
  const disclosure = useDockDisclosure()
  const flying = useFlyingReactions(players)

  const send = (reaction: ReactionType) => {
    try {
      client.send(buildClientMessage('reaction.send', { reaction }))
    } catch {}
  }

  return { ...disclosure, flying, pickerId, send }
}
