import { useCallback, useRef } from 'react'
import { useControllerLink } from '@/realtime/controllerLink/ControllerLinkContext'
import type { RelayableClientMessage } from '@/realtime/controllerLink/relay'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import { buildClientMessage, type ClientMessage } from '@/realtime/wsEvents'
import type { HeldDice } from '@/yacht/domain/dice'

const SHAKE_RELAY_INTERVAL_MS = 60

export function useRollBroadcast(roomId: string, roundNumber: number) {
  const realtimeClient = useRealtimeClient()
  const controllerLink = useControllerLink()
  const lastShakeSentAtRef = useRef(0)

  /**
   * 연출 릴레이는 컨트롤러 링크(WebRTC DataChannel)를 **먼저** 시도하고, 링크가 없거나
   * 채널이 닫혀 있으면 그 자리에서 WebSocket으로 보낸다. 두 경로로 동시에 보내지 않는다 —
   * 파티 방에서 이 두 이벤트를 소비하는 화면은 대시보드뿐이라(controller-link.md)
   * 링크가 닿았으면 서버 릴레이는 같은 그림을 한 번 더 그리는 일이 된다.
   */
  const publishRelay = useCallback(
    (message: RelayableClientMessage) => {
      if (controllerLink.trySend(message)) return
      sendQuietly(realtimeClient, message)
    },
    [controllerLink, realtimeClient],
  )

  const publishHeld = useCallback(
    (held: HeldDice) => {
      // 킵은 서버가 라운드 상태에 저장하는 권위 메시지다 — 링크로 보내면 안 된다.
      sendQuietly(
        realtimeClient,
        buildClientMessage('game.yacht_dice.dice.hold', { held, roundNumber }, { roomId }),
      )
    },
    [realtimeClient, roomId, roundNumber],
  )

  const publishShake = useCallback(
    (direction: 'left' | 'right', strength: number) => {
      const now = performance.now()
      if (now - lastShakeSentAtRef.current < SHAKE_RELAY_INTERVAL_MS) return
      lastShakeSentAtRef.current = now
      publishRelay(
        buildClientMessage(
          'game.yacht_dice.dice.shake',
          { direction, roundNumber, strength },
          { roomId },
        ),
      )
    },
    [publishRelay, roomId, roundNumber],
  )

  const publishThrow = useCallback(
    (rollCount: number) => {
      publishRelay(
        buildClientMessage(
          'game.yacht_dice.dice.throw',
          { rollCount: rollCount as 1 | 2 | 3, roundNumber },
          { roomId },
        ),
      )
    },
    [publishRelay, roomId, roundNumber],
  )

  return { publishHeld, publishShake, publishThrow }
}

/**
 * 전송 실패를 삼킨다. 흔들림·던지기·킵은 유실돼도 다음 신호나 서버 스냅샷이 덮으므로,
 * 못 보낸 것을 사용자에게 알릴 이유가 없다(권위 메시지인 `dice.roll`은 반대로 실패를
 * 화면에 알린다 — `useGamePlayRoll`).
 */
function sendQuietly(client: RealtimeClient, message: ClientMessage) {
  try {
    client.send(message)
  } catch {}
}
