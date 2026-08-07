import { describe, expect, it } from 'vitest'
import { createRollTracking } from '@/yacht/model/roll/tracking'

const REQUEST = { inputMode: 'motion', msgId: 'm1', requestId: 'r1' } as const

describe('createRollTracking', () => {
  it('답이 오면 들고 있던 요청을 돌려주고 비운다', () => {
    const tracking = createRollTracking()
    tracking.requested(REQUEST)

    expect(tracking.settle()).toEqual(REQUEST)
    expect(tracking.settle()).toBeNull()
    expect(tracking.pending).toBeNull()
  })

  it('미리 눌린 던짐은 모션 굴림일 때만 적어 둔다', () => {
    const tracking = createRollTracking()

    tracking.queueMotionRelease()
    expect(tracking.takeQueuedMotionRelease()).toBe(false)

    tracking.requested(REQUEST)
    tracking.queueMotionRelease()
    expect(tracking.takeQueuedMotionRelease()).toBe(true)
  })

  it('적어 둔 던짐은 한 번만 소비된다', () => {
    const tracking = createRollTracking()
    tracking.requested(REQUEST)
    tracking.queueMotionRelease()

    expect(tracking.takeQueuedMotionRelease()).toBe(true)
    expect(tracking.takeQueuedMotionRelease()).toBe(false)
  })

  it('새 요청은 미리 눌린 던짐을 초기화한다', () => {
    const tracking = createRollTracking()
    tracking.requested(REQUEST)
    tracking.queueMotionRelease()

    tracking.requested({ ...REQUEST, requestId: 'r2' })

    expect(tracking.takeQueuedMotionRelease()).toBe(false)
  })

  it('받아들인 턴은 한 번 꺼내면 비워진다', () => {
    const tracking = createRollTracking()
    tracking.accept({ playerId: 'p1', roundNumber: 2 })

    expect(tracking.takeAcceptedTurn()).toEqual({ playerId: 'p1', roundNumber: 2 })
    expect(tracking.takeAcceptedTurn()).toBeNull()
  })

  it('턴이 넘어가면 넷을 함께 버린다', () => {
    const tracking = createRollTracking()
    tracking.requested(REQUEST)
    tracking.queueMotionRelease()
    tracking.accept({ playerId: 'p1', roundNumber: 2 })
    tracking.remote.rollAccepted({ requestId: 'x', rollCount: 1, roundNumber: 2 })

    tracking.reset()

    expect(tracking.pending).toBeNull()
    expect(tracking.takeQueuedMotionRelease()).toBe(false)
    expect(tracking.takeAcceptedTurn()).toBeNull()
    expect(tracking.remote.rolling).toBe(false)
  })
})
