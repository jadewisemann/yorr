import { useCallback, useEffect, useRef, useState } from 'react'
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

export function useMotionRollInput(onGestureEvent: (event: MotionGestureEvent) => void) {
  const eventCallbackRef = useRef(onGestureEvent)
  const controllerRef = useRef<MotionInputController | null>(null)
  const [availability, setAvailability] = useState<MotionAvailability>('unknown')
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT)
  eventCallbackRef.current = onGestureEvent

  useEffect(() => {
    const controller = new MotionInputController({
      onAvailabilityChange: setAvailability,
      onGestureEvent: (event) => eventCallbackRef.current(event),
      onGestureSnapshot: setSnapshot,
    })
    controllerRef.current = controller
    controller.start()
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [])

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
