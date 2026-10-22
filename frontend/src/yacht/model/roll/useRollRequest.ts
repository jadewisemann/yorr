import { useCallback, useEffect, useRef } from 'react'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import { buildClientMessage } from '@/realtime/wsEvents'
import type { YachtGameState } from '@/yacht/domain/yachtGame'
import type { RollInputMode } from './animation'
import type { RollPresentation, RollPresentationAction } from './presentation'
import type { RollTracking } from './tracking'

interface RollRequestOptions {
  canRoll: boolean
  local: YachtGameState
  realtimeClient: RealtimeClient
  roomId: string
  roundNumber: number
  showToast: (message: string) => void
  present: (action: RollPresentationAction) => void
  tracking: RollTracking
  inputModeRef: { current: RollPresentation['inputMode'] }
}

/**
 * 굴림 요청 한 번. 요청 ID·메시지 ID를 만들고 **보내기 전에** 추적기에 등록한다 —
 * 응답이 요청보다 먼저 도착하는 경우에도 짝을 찾을 수 있어야 한다. 전송이 던지면
 * 추적을 되돌리고 토스트로 알린다(그대로 두면 영원히 "요청 중"이 된다).
 */
export function useRollRequest(options: RollRequestOptions) {
  const { canRoll, local, realtimeClient, roomId, roundNumber, showToast, present, tracking } =
    options
  const sequenceRef = useRef(0)
  const inputModeRef = options.inputModeRef

  return useCallback(
    (inputMode: RollInputMode) => {
      if (!canRoll) return
      sequenceRef.current += 1
      const requestId = `r${roundNumber}-${sequenceRef.current}`
      const msgId = `roll-${roundNumber}-${local.rollCount + 1}-${Date.now()}`
      present({ type: 'requested', inputMode })
      inputModeRef.current = inputMode
      tracking.requested({ inputMode, msgId, requestId })
      try {
        realtimeClient.send(
          buildClientMessage(
            'game.yacht_dice.dice.roll',
            {
              held: local.held,
              rollCount: (local.rollCount + 1) as 1 | 2 | 3,
              roundNumber,
            },
            { roomId, msgId },
          ),
        )
      } catch {
        tracking.settle()
        present({ type: 'requestFailed' })
        showToast('주사위를 요청하지 못했어요. 연결 상태를 확인해 주세요.')
      }
    },
    [
      canRoll,
      inputModeRef,
      local,
      present,
      realtimeClient,
      roomId,
      roundNumber,
      showToast,
      tracking,
    ],
  )
}

/**
 * 차례가 바뀌면 로컬 판을 새로 연다 — 단, **그 차례의 주사위가 이미 늦게 도착한** 경우에는
 * 방금 받은 결과를 버리지 않는다(수락한 굴림의 턴과 라운드가 같으면 유지).
 */
export function useTurnReset(options: {
  activePlayerId: string | undefined
  roundNumber: number
  resetLocalFor: (round: number) => void
  present: (action: RollPresentationAction) => void
  tracking: RollTracking
}) {
  const { activePlayerId, roundNumber, resetLocalFor, present, tracking } = options
  const activePlayerRef = useRef(activePlayerId)

  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    const accepted = tracking.takeAcceptedTurn()
    const alreadyArrived =
      accepted?.playerId === activePlayerId && accepted?.roundNumber === roundNumber
    if (!alreadyArrived) resetLocalFor(roundNumber)
    present({ type: 'turnReset' })
    tracking.reset()
  }, [activePlayerId, present, resetLocalFor, roundNumber, tracking])
}
