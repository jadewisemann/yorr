import { useCallback, useEffect, useRef, useState } from 'react'

export type SwingPermission = 'unknown' | 'granted' | 'denied' | 'unsupported'

const SWING_COOLDOWN_MS = 220 // 스윙 사이 최소 간격
const DEFAULT_THRESHOLD = 14 // 스윙으로 볼 가속도 크기(m/s^2)
const RELEASE_RATIO = 0.45
const GRAVITY_ALPHA = 0.08

interface UseSwingOptions {
  onSwing: () => void
  enabled?: boolean
  threshold?: number
}

/** 스윙 판정의 상태 — 무장 여부와 마지막 발화 시각. */
export interface SwingState {
  armed: boolean
  lastSwingAt: number
}

/**
 * 이번 샘플이 스윙인가 — 상태를 제자리에서 갱신하고 발화 여부만 돌려준다.
 *
 * 왜 순수 함수인가: 히스테리시스(무장/해제)와 쿨다운이 **규칙**이라, 훅 안에
 * 두면 타이머·이벤트와 섞여 "왜 이 스윙이 무시됐나"를 재현할 수 없다. 순수하게
 * 두면 임계값 근처의 두 샘플만으로 시험할 수 있다.
 */
export const advanceSwing = (
  state: SwingState,
  { magnitude, threshold, now }: { magnitude: number; threshold: number; now: number },
): boolean => {
  // 놓아야 다시 무장한다 — 한 번의 흔들림이 스윙 여러 번으로 세어지지 않게.
  if (!state.armed) {
    state.armed = magnitude < threshold * RELEASE_RATIO
    return false
  }
  if (magnitude < threshold || now - state.lastSwingAt <= SWING_COOLDOWN_MS) return false
  state.lastSwingAt = now
  state.armed = false
  return true
}

interface MotionVector {
  x: number
  y: number
  z: number
}

function motionVector(event: DeviceMotionEvent): MotionVector | null {
  const acceleration =
    event.acceleration && event.acceleration.x !== null
      ? event.acceleration
      : event.accelerationIncludingGravity
  if (!acceleration) return null
  return {
    x: acceleration.x ?? 0,
    y: acceleration.y ?? 0,
    z: acceleration.z ?? 0,
  }
}

function highPassMagnitude(sample: MotionVector, gravity: MotionVector) {
  gravity.x += (sample.x - gravity.x) * GRAVITY_ALPHA
  gravity.y += (sample.y - gravity.y) * GRAVITY_ALPHA
  gravity.z += (sample.z - gravity.z) * GRAVITY_ALPHA
  const dx = sample.x - gravity.x
  const dy = sample.y - gravity.y
  const dz = sample.z - gravity.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

type DeviceMotionApi = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function deviceMotionApi() {
  return window.DeviceMotionEvent as DeviceMotionApi | undefined
}

/** iOS는 사용자 제스처 안에서 권한을 물어야 한다. 묻는 API가 없으면 이미 허용된 것이다. */
async function askMotionPermission(deviceMotion: DeviceMotionApi): Promise<'granted' | 'denied'> {
  try {
    if (typeof deviceMotion.requestPermission !== 'function') return 'granted'
    return (await deviceMotion.requestPermission()) === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/**
 * devicemotion 구독. 콜백·활성·임계값은 ref로 들어 리스너를 갈아 끼우지 않는다 —
 * 스윙 판정 상태(무장·쿨다운·중력 추정)가 렌더마다 끊기면 안 된다.
 */
function useMotionListener({ onSwing, enabled, threshold }: Required<UseSwingOptions>) {
  const onSwingRef = useRef(onSwing)
  const enabledRef = useRef(enabled)
  const thresholdRef = useRef(threshold)
  useEffect(() => {
    onSwingRef.current = onSwing
    enabledRef.current = enabled
    thresholdRef.current = threshold
  }, [onSwing, enabled, threshold])

  const swingState = useRef<SwingState>({ armed: true, lastSwingAt: 0 })
  const listening = useRef(false)
  const grav = useRef({ x: 0, y: 0, z: 0 })

  const handleMotion = useCallback((e: DeviceMotionEvent) => {
    if (!enabledRef.current) return
    const sample = motionVector(e)
    if (!sample) return

    const mag = highPassMagnitude(sample, grav.current)
    // 시각은 한 번만 읽는다 — 두 번 읽으면 그 사이 시간이 쿨다운에 섞인다.
    const now = Date.now()
    const fired = advanceSwing(swingState.current, {
      magnitude: mag,
      threshold: thresholdRef.current,
      now,
    })
    if (fired) onSwingRef.current()
  }, [])

  const startListening = useCallback(() => {
    if (listening.current) return
    grav.current = { x: 0, y: 0, z: 0 }
    swingState.current.armed = true
    window.addEventListener('devicemotion', handleMotion)
    listening.current = true
  }, [handleMotion])

  const stopListening = useCallback(() => {
    if (!listening.current) return
    window.removeEventListener('devicemotion', handleMotion)
    listening.current = false
  }, [handleMotion])

  return { startListening, stopListening }
}

export function useSwing({
  onSwing,
  enabled = true,
  threshold = DEFAULT_THRESHOLD,
}: UseSwingOptions) {
  const [permission, setPermission] = useState<SwingPermission>('unknown')
  const { startListening, stopListening } = useMotionListener({ onSwing, enabled, threshold })

  useEffect(() => {
    const deviceMotion = deviceMotionApi()
    if (!deviceMotion) {
      setPermission('unsupported')
      return
    }
    if (typeof deviceMotion.requestPermission !== 'function') {
      startListening()
      setPermission('granted')
    }
    return stopListening
  }, [startListening, stopListening])

  const requestPermission = useCallback(async () => {
    const deviceMotion = deviceMotionApi()
    if (!deviceMotion) {
      setPermission('unsupported')
      return
    }
    const result = await askMotionPermission(deviceMotion)
    if (result === 'granted') startListening()
    setPermission(result)
  }, [startListening])

  return { permission, requestPermission }
}
