import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { MotionInputController } from './MotionInputController'
import type { MotionAvailability, MotionGestureEvent, MotionGestureSnapshot } from './motionTypes'

const INITIAL_SNAPSHOT: MotionGestureSnapshot = {
  calibrated: false,
  canConfirmThrow: false,
  effectiveThresholds: {
    shakeMinRms: 3.5,
    shakePeak: 6,
    shakePeakRelease: 2.5,
    throwImpulse: 0.9,
    throwJerk: 70,
    throwPeak: 12,
  },
  gestureState: 'idle',
  lastPulseDirection: null,
  noiseRms: 0,
  reversalCount: 0,
}

/**
 * 흔들기 입력. `enabled=false`면 센서를 <b>시작조차 하지 않는다</b> — availability가 'unknown'에
 * 머물러 권한 안내도 뜨지 않고 inputMode는 'tap'이 된다.
 *
 * 끌 수 있어야 하는 이유: 파티 모드 대시보드처럼 <b>턴을 가질 수 없는 화면</b>도 게임 화면을
 * 그린다. 거기서 컨트롤러를 켜면 TV·모니터가 모션 권한을 묻고 흔들기 안내를 띄운다 —
 * 그 기기로는 애초에 굴릴 수 없으므로 물어볼 이유가 없다. 패널만 숨기는 것으로는 부족하다
 * (센서 구독은 그대로 남는다).
 */
export function useMotionRollInput(
  onGestureEvent: (event: MotionGestureEvent) => void,
  enabled = true,
) {
  const gestureEvent = useEffectEvent(onGestureEvent)
  const controllerRef = useRef<MotionInputController | null>(null)
  const [availability, setAvailability] = useState<MotionAvailability>('unknown')
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT)

  useEffect(() => {
    if (!enabled) return
    const controller = new MotionInputController({
      onAvailabilityChange: setAvailability,
      onGestureEvent: (event) => gestureEvent(event),
      onGestureSnapshot: setSnapshot,
    })
    controllerRef.current = controller
    controller.start()
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [enabled])

  const requestPermission = useCallback(
    () => controllerRef.current?.requestPermission() ?? Promise.resolve(),
    [],
  )
  const resetGesture = useCallback((reason?: string) => {
    controllerRef.current?.reset(reason)
  }, [])

  const inputMode = availability === 'listening' || availability === 'paused' ? 'motion' : 'tap'
  return {
    ...snapshot,
    availability,
    inputMode,
    requestPermission,
    resetGesture,
  } as const
}
