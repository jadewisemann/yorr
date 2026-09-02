import { act } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeResizeObserver } from '@/test/threeStubs'
import { sceneControl } from './sceneDouble'

export const FRAME_MS = 16

/**
 * 탁구 훅들은 `requestAnimationFrame` 위에서 돈다. 가짜 타이머가 rAF와 `performance` 시계를
 * 함께 멎게 하므로, 검사가 프레임 수를 정하면 물리와 보고 주기가 그대로 재현된다.
 */
export function installFrameLoop() {
  beforeEach(() => {
    vi.useFakeTimers()
    sceneControl.reset()
    FakeResizeObserver.reset()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    // 봇의 판단과 서브 지점을 고정한다 — 같은 프레임 수는 늘 같은 점수로 이어진다.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })
}

export function runFrames(count: number) {
  act(() => void vi.advanceTimersByTime(FRAME_MS * count))
}
