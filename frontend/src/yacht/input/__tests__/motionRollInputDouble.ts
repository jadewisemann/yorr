import { vi } from 'vitest'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'

/**
 * 모션 입력이 없는 기기의 대역. 화면 검사 다섯 곳이 같은 값을 쓰므로 여기 한자리에 둔다
 * — 탭으로만 굴리는 흐름이 이 스위트들의 전제다.
 */
export const useMotionRollInput = (_onGestureEvent: (event: MotionGestureEvent) => void) => ({
  availability: 'unsupported' as const,
  calibrated: true,
  canConfirmThrow: false,
  gestureState: 'idle' as const,
  inputMode: 'tap' as const,
  lastPulseDirection: null,
  noiseRms: 0,
  requestPermission: vi.fn(),
  resetGesture: vi.fn(),
  reversalCount: 0,
})
