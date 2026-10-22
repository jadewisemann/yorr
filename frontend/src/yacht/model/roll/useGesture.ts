import { useCallback, useEffect } from 'react'
import { getPendingRoll, type YachtGameState } from '@/yacht/domain/yachtGame'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'
import type { RollInputMode } from './animation'
import type { RollPresentation, RollPresentationAction } from './presentation'
import type { RollTracking } from './tracking'

const TAP_RELEASE_DELAY_MS = 600

interface RollGestureOptions {
  local: YachtGameState
  inputModeRef: { current: RollPresentation['inputMode'] }
  tracking: RollTracking
  beginRoll: (inputMode: RollInputMode) => void
  feedback: {
    pulse: (direction: 'left' | 'right', strength: number, source: 'local') => void
    armed: () => void
    thrown: () => void
  }
  present: (action: RollPresentationAction) => void
  publishShake: (direction: 'left' | 'right', strength: number) => void
  publishThrow: (rollCount: number) => void
}

/**
 * 모션 입력이 만드는 굴림 의도(흔들기·던지기)를 서버 흐름에 잇는다.
 * `throwDetected`에서 아직 요청이 없으면 **던짐을 큐에 넣어 두고** 요청이 도착할 때
 * 맞춘다 — 흔들기와 던지기의 순서가 뒤집히는 경우가 실제로 있다.
 */
export function useRollGesture(options: RollGestureOptions) {
  const { local, inputModeRef, tracking, beginRoll, present, publishThrow } = options
  const { feedback, publishShake } = options

  return useCallback(
    (event: MotionGestureEvent) => {
      switch (event.type) {
        case 'shakePulse':
          feedback.pulse(event.direction, event.strength, 'local')
          publishShake(event.direction, event.strength)
          return
        case 'shakeStarted':
          feedback.armed()
          beginRoll('motion')
          return
        case 'throwDetected':
          handleThrow({ feedback, inputModeRef, local, present, publishThrow, tracking })
          return
        case 'shakeArmed':
        case 'gestureCancelled':
          return
      }
    },
    [beginRoll, feedback, inputModeRef, local, present, publishShake, publishThrow, tracking],
  )
}

type ThrowOptions = Pick<
  RollGestureOptions,
  'feedback' | 'inputModeRef' | 'local' | 'present' | 'publishThrow' | 'tracking'
>

/** 던짐 감지. 요청이 아직 없으면 큐에 넣어 두고, 도착했을 때 맞춘다. */
function handleThrow(options: ThrowOptions) {
  const { local, inputModeRef, tracking, present, publishThrow, feedback } = options
  if (inputModeRef.current !== 'motion') return
  const request = getPendingRoll(local)
  if (!request) {
    tracking.queueMotionRelease()
    return
  }
  feedback.thrown()
  present({ type: 'released', requestId: request.requestId })
  publishThrow(local.rollCount)
}

/**
 * 탭·자동 입력은 놓아주기 신호가 없다 — 요청이 생기면 잠시 뒤 스스로 던짐을 알린다.
 * 모션 입력은 `throwDetected`가 그 역할을 하므로 여기서 건드리지 않는다.
 */
export function useTapRelease(options: {
  local: YachtGameState
  rollInputMode: RollPresentation['inputMode']
  publishThrow: (rollCount: number) => void
  present: (action: RollPresentationAction) => void
}) {
  const { local, rollInputMode, publishThrow, present } = options
  const pendingRoll = getPendingRoll(local)

  useEffect(() => {
    if (!pendingRoll || (rollInputMode !== 'tap' && rollInputMode !== 'auto')) return
    const timeout = setTimeout(() => {
      present({ type: 'released', requestId: pendingRoll.requestId })
      if (rollInputMode === 'tap') publishThrow(local.rollCount)
    }, TAP_RELEASE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [local.rollCount, pendingRoll, publishThrow, rollInputMode, present])
}
