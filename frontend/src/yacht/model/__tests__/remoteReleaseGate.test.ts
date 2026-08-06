import { describe, expect, it } from 'vitest'
import { createRemoteReleaseGate } from '@/yacht/model/remoteReleaseGate'

const ROLL = { requestId: 'r1', rollCount: 2, roundNumber: 3 }
const THROW = { rollCount: 2, roundNumber: 3 }

/**
 * 이 파일이 검사하는 성질은 하나다 — **두 신호의 도착 순서와 무관하게 같은 결과**.
 * 실제 회선에서 `dice.thrown`과 `dice.broadcast`의 순서는 보장되지 않는다.
 */
describe('createRemoteReleaseGate', () => {
  it('굴림이 먼저 오면 던짐을 기다렸다가 쏟는다', () => {
    const gate = createRemoteReleaseGate()

    expect(gate.rollAccepted(ROLL)).toBeNull()
    expect(gate.throwObserved(THROW)).toBe('r1')
  })

  it('던짐이 먼저 와도 같은 결과다', () => {
    const gate = createRemoteReleaseGate()

    expect(gate.throwObserved(THROW)).toBeNull()
    expect(gate.rollAccepted(ROLL)).toBe('r1')
  })

  it('라운드나 굴림 횟수가 다르면 짝이 아니다 — 지난 굴림의 던짐으로 쏟지 않는다', () => {
    const gate = createRemoteReleaseGate()

    gate.throwObserved({ rollCount: 1, roundNumber: 3 })

    expect(gate.rollAccepted(ROLL)).toBeNull()
  })

  it('내 굴림이면(원격 아님) 진행 중인 것을 지운다', () => {
    const gate = createRemoteReleaseGate()
    gate.rollAccepted(ROLL)

    expect(gate.rollAccepted(null)).toBeNull()
    expect(gate.rolling).toBe(false)
  })

  /** 흔들림 연출은 굴림이 진행 중일 때만 그린다 — 던진 뒤에는 그릴 것이 없다. */
  it('굴림이 서 있는 동안만 rolling이다', () => {
    const gate = createRemoteReleaseGate()
    expect(gate.rolling).toBe(false)

    gate.rollAccepted(ROLL)
    expect(gate.rolling).toBe(true)

    gate.throwObserved(THROW)
    expect(gate.rolling).toBe(false)
  })

  it('턴이 넘어가면 기다리던 짝을 버린다', () => {
    const gate = createRemoteReleaseGate()
    gate.throwObserved(THROW)

    gate.reset()

    expect(gate.rollAccepted(ROLL)).toBeNull()
  })

  it('한 번 쏟은 짝으로 두 번 쏟지 않는다', () => {
    const gate = createRemoteReleaseGate()
    gate.rollAccepted(ROLL)
    expect(gate.throwObserved(THROW)).toBe('r1')

    expect(gate.throwObserved(THROW)).toBeNull()
  })
})
