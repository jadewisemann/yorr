import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type Player, type ReactionType } from '@/realtime/wsEvents'
import { resolveRovingKey } from '@/shared/rovingFocus'
import { FLIGHT_MS, type Flying, MAX_FLYING, REACTIONS } from '@/yacht/domain/reactions'

export function useReactionDock(players: Player[]) {
  const client = useRealtimeClient()
  const pickerId = useId()
  const [open, setOpen] = useState(false)
  const [flying, setFlying] = useState<Flying[]>([])
  const dockRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const chipsRef = useRef<(HTMLButtonElement | null)[]>([])
  const [focusedChip, setFocusedChip] = useState(0)
  const playersRef = useRef(players)
  useLayoutEffect(() => {
    playersRef.current = players
  })
  const nextIdRef = useRef(0)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const unsubscribe = client.onMessage((message) => {
      if (message.type !== 'reaction.broadcast') return
      const { playerId, reaction } = message.payload
      const id = nextIdRef.current++
      const known = REACTIONS.find((candidate) => candidate.type === reaction)
      setFlying((current) => [
        ...current.slice(-(MAX_FLYING - 1)),
        {
          emoji: known?.emoji ?? '💬',
          id,
          label: known?.label ?? '',
          nickname:
            playersRef.current.find((player) => player.playerId === playerId)?.nickname ?? '',
        },
      ])
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

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
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
  }, [close, open])

  useEffect(() => {
    if (!open) return
    setFocusedChip(0)
    chipsRef.current[0]?.focus()
  }, [open])

  const send = (reaction: ReactionType) => {
    try {
      client.send(buildClientMessage('reaction.send', { reaction }))
    } catch {}
  }

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
