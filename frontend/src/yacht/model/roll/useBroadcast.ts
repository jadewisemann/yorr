import { useCallback, useRef } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage } from '@/realtime/wsEvents'
import type { HeldDice } from '@/yacht/domain/dice'

const SHAKE_RELAY_INTERVAL_MS = 60

export function useRollBroadcast(roomId: string, roundNumber: number) {
  const realtimeClient = useRealtimeClient()
  const lastShakeSentAtRef = useRef(0)

  const publishHeld = useCallback(
    (held: HeldDice) => {
      try {
        realtimeClient.send(
          buildClientMessage('game.yacht_dice.dice.hold', { held, roundNumber }, { roomId }),
        )
      } catch {}
    },
    [realtimeClient, roomId, roundNumber],
  )

  const publishShake = useCallback(
    (direction: 'left' | 'right', strength: number) => {
      const now = performance.now()
      if (now - lastShakeSentAtRef.current < SHAKE_RELAY_INTERVAL_MS) return
      lastShakeSentAtRef.current = now
      try {
        realtimeClient.send(
          buildClientMessage(
            'game.yacht_dice.dice.shake',
            { direction, roundNumber, strength },
            { roomId },
          ),
        )
      } catch {}
    },
    [realtimeClient, roomId, roundNumber],
  )

  const publishThrow = useCallback(
    (rollCount: number) => {
      try {
        realtimeClient.send(
          buildClientMessage(
            'game.yacht_dice.dice.throw',
            { rollCount: rollCount as 1 | 2 | 3, roundNumber },
            { roomId },
          ),
        )
      } catch {}
    },
    [realtimeClient, roomId, roundNumber],
  )

  return { publishHeld, publishShake, publishThrow }
}
