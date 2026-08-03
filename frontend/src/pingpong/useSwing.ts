import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useSwing
 * -------------------------------------------------------------
 * 휴대폰을 "왕복으로 스윙"하는 동작을 DeviceMotion(가속도)으로 감지해
 * onSwing() 을 호출한다. (탁구 라켓 휘두르기 트리거)
 *
 * - 스윙 = 순간 가속도 크기가 임계값을 넘는 스파이크. 쿨다운으로 왕복 중
 *   과도하게 여러 번 잡히지 않게 한다.
 * - iOS 13+ 는 requestPermission() 을 버튼 탭 안에서 호출해야 한다(HTTPS 필수).
 * - 연결/권한이 없으면 게임은 마우스 클릭으로 스윙 (이 훅과 무관하게 동작).
 */

export type SwingPermission = 'unknown' | 'granted' | 'denied' | 'unsupported'

const SWING_COOLDOWN_MS = 220 // 스윙 사이 최소 간격
const DEFAULT_THRESHOLD = 14 // 스윙으로 볼 가속도 크기(m/s^2)
/** 다음 스윙을 받기 전에 가속도가 여기까지 내려와야 한다 (한 번의 휘두름이 여러 번 잡히는 것 방지) */
const RELEASE_RATIO = 0.45
/** 중력 추정 저역통과 계수 — 작을수록 천천히 따라간다 */
const GRAVITY_ALPHA = 0.08

interface UseSwingOptions {
  onSwing: () => void
  enabled?: boolean
  threshold?: number
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
  /** 저역통과로 추정한 중력 벡터 */
  const grav = useRef({ x: 0, y: 0, z: 0 })
  /** 스파이크가 한 번 내려갔는지 (히스테리시스) */
  const armed = useRef(true)

  const handleMotion = useCallback((e: DeviceMotionEvent) => {
    if (!enabledRef.current) return
    const acc =
      e.acceleration && e.acceleration.x !== null ? e.acceleration : e.accelerationIncludingGravity
    if (!acc) return
    const x = acc.x ?? 0
    const y = acc.y ?? 0
    const z = acc.z ?? 0

    // 중력 성분을 저역통과로 추정해 뺀다.
    //  - accelerationIncludingGravity 로 폴백한 기기(안드로이드 일부)에서는 가만히 든 폰도
    //    9.8 을 찍어서, 빼주지 않으면 임계값 14 가 실질 4 밖에 안 남는다 → 살짝만 움직여도 오감지.
    //  - 이미 중력이 빠진 acceleration 이면 추정치가 0 근처라 빼도 그대로다.
    const g = grav.current
    g.x += (x - g.x) * GRAVITY_ALPHA
    g.y += (y - g.y) * GRAVITY_ALPHA
    g.z += (z - g.z) * GRAVITY_ALPHA
    const dx = x - g.x
    const dy = y - g.y
    const dz = z - g.z
    const mag = Math.sqrt(dx * dx + dy * dy + dz * dz)

    const th = thresholdRef.current
    // 한 번 임계값을 넘으면, 다시 충분히 잦아들기 전까지는 새 스윙으로 안 친다.
    if (!armed.current) {
      if (mag < th * RELEASE_RATIO) armed.current = true
      return
    }
    const now = Date.now()
    if (mag >= th && now - lastSwingAt.current > SWING_COOLDOWN_MS) {
      lastSwingAt.current = now
      armed.current = false
      onSwingRef.current()
    }
  }, [])

  /** 버튼 탭 안에서 호출 (iOS 권한 팝업) */
  const requestPermission = useCallback(async () => {
    if (typeof DeviceMotionEvent === 'undefined') {
      setPermission('unsupported')
      return
    }
    const anyDME = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }
    try {
      if (typeof anyDME.requestPermission === 'function') {
        const res = await anyDME.requestPermission()
        if (res === 'granted') {
          window.addEventListener('devicemotion', handleMotion)
          setPermission('granted')
        } else {
          setPermission('denied')
        }
      } else {
        window.addEventListener('devicemotion', handleMotion)
        setPermission('granted')
      }
    } catch {
      setPermission('denied')
    }
  }, [handleMotion])

  useEffect(() => () => window.removeEventListener('devicemotion', handleMotion), [handleMotion])

  return { permission, requestPermission }
}
