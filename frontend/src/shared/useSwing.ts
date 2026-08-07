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

export function useSwing({
  onSwing,
  enabled = true,
  threshold = DEFAULT_THRESHOLD,
}: UseSwingOptions) {
  const [permission, setPermission] = useState<SwingPermission>('unknown')

  const onSwingRef = useRef(onSwing)
  const enabledRef = useRef(enabled)
  const thresholdRef = useRef(threshold)
  useEffect(() => {
    onSwingRef.current = onSwing
    enabledRef.current = enabled
    thresholdRef.current = threshold
  }, [onSwing, enabled, threshold])

  const lastSwingAt = useRef(0)
  const listening = useRef(false)
  const grav = useRef({ x: 0, y: 0, z: 0 })
  const armed = useRef(true)

  const handleMotion = useCallback((e: DeviceMotionEvent) => {
    if (!enabledRef.current) return
    const sample = motionVector(e)
    if (!sample) return

    const mag = highPassMagnitude(sample, grav.current)

    const th = thresholdRef.current
    if (!armed.current) {
      armed.current = mag < th * RELEASE_RATIO
      return
    }
    const now = Date.now()
    if (mag < th || now - lastSwingAt.current <= SWING_COOLDOWN_MS) return
    lastSwingAt.current = now
    armed.current = false
    onSwingRef.current()
  }, [])

  const startListening = useCallback(() => {
    if (listening.current) return
    grav.current = { x: 0, y: 0, z: 0 }
    armed.current = true
    window.addEventListener('devicemotion', handleMotion)
    listening.current = true
  }, [handleMotion])

  const stopListening = useCallback(() => {
    if (!listening.current) return
    window.removeEventListener('devicemotion', handleMotion)
    listening.current = false
  }, [handleMotion])

  useEffect(() => {
    const deviceMotion = window.DeviceMotionEvent as
      | (typeof DeviceMotionEvent & {
          requestPermission?: () => Promise<'granted' | 'denied'>
        })
      | undefined
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
    const deviceMotion = window.DeviceMotionEvent as
      | (typeof DeviceMotionEvent & {
          requestPermission?: () => Promise<'granted' | 'denied'>
        })
      | undefined
    if (!deviceMotion) {
      setPermission('unsupported')
      return
    }
    try {
      if (typeof deviceMotion.requestPermission === 'function') {
        const res = await deviceMotion.requestPermission()
        if (res === 'granted') {
          startListening()
          setPermission('granted')
        } else {
          setPermission('denied')
        }
      } else {
        startListening()
        setPermission('granted')
      }
    } catch {
      setPermission('denied')
    }
  }, [startListening])

  return { permission, requestPermission }
}
