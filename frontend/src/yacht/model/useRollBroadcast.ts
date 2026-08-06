import { useCallback, useRef } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage } from '@/realtime/wsEvents'
import type { HeldDice } from '@/yacht/domain/dice'

/**
 * 흔들림을 이보다 촘촘히 보내지 않는다. 센서는 60Hz로 들어오는데 그대로 중계하면 초당 60개가
 * 나가고, 받는 쪽 연출은 그만큼 촘촘하지 않아도 같아 보인다.
 */
const SHAKE_RELAY_INTERVAL_MS = 60

/**
 * 내 굴림 동작을 같은 방에 알린다 — 킵, 흔들림, 던짐.
 *
 * 셋 다 <b>연출용 신호</b>다. 판정은 서버가 하고 그 결과는 broadcast로 따로 온다. 그래서
 * 전송 실패를 여기서 되돌리지 않는다 — 연결 문제는 ConnectionBanner가 이미 말하고 있고,
 * 신호 하나를 놓쳤다고 게임이 멈추면 안 된다.
 */
export function useRollBroadcast(roomId: string, roundNumber: number) {
  const realtimeClient = useRealtimeClient()
  const lastShakeSentAtRef = useRef(0)

  const publishHeld = useCallback(
    (held: HeldDice) => {
      try {
        realtimeClient.send(
          buildClientMessage('game.yacht_dice.dice.hold', { held, roundNumber }, { roomId }),
        )
      } catch {
        // ConnectionBanner owns transport failure feedback.
      }
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
      } catch {
        // ConnectionBanner owns transport failure feedback.
      }
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
      } catch {
        // A lost presentation signal must not block the game.
      }
    },
    [realtimeClient, roomId, roundNumber],
  )

  return { publishHeld, publishShake, publishThrow }
}
