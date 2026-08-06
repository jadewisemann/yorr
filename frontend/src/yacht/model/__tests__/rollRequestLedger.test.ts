import { describe, expect, it, vi } from 'vitest'
import { createRollRequestLedger } from '@/yacht/model/rollRequestLedger'

/**
 * 같은 요청이 두 경로로 도착한다 — 월드가 서 있으면 effect가, 로드 중이었으면 생성 직후의
 * replay가 처리한다. 둘 다 도는 경우가 실제로 있어서(늦게 도착한 굴림) 여기가 유일한 방어선이다.
 */
describe('createRollRequestLedger', () => {
  it('같은 요청의 시작은 한 번만 실행한다', () => {
    const ledger = createRollRequestLedger()
    const start = vi.fn()

    expect(ledger.startOnce('r1', start)).toBe(true)
    expect(ledger.startOnce('r1', start)).toBe(false)

    expect(start).toHaveBeenCalledOnce()
  })

  it('쏟기도 한 번만 — 두 번 쏟으면 주사위가 두 번 쏟아진다', () => {
    const ledger = createRollRequestLedger()
    const pour = vi.fn()

    ledger.releaseOnce('r1', pour)
    ledger.releaseOnce('r1', pour)

    expect(pour).toHaveBeenCalledOnce()
  })

  it('완료 통보도 한 번만 — 두 번이면 점수가 두 번 기록된다', () => {
    const ledger = createRollRequestLedger()
    const complete = vi.fn()

    ledger.completeOnce('r1', complete)
    ledger.completeOnce('r1', complete)

    expect(complete).toHaveBeenCalledOnce()
  })

  /** 셋은 서로 다른 단계다 — 시작했다고 쏟은 것이 아니고, 쏟았다고 끝난 것도 아니다. */
  it('시작·쏟기·완료는 서로를 막지 않는다', () => {
    const ledger = createRollRequestLedger()
    const calls: string[] = []

    ledger.startOnce('r1', () => calls.push('start'))
    ledger.releaseOnce('r1', () => calls.push('pour'))
    ledger.completeOnce('r1', () => calls.push('complete'))

    expect(calls).toEqual(['start', 'pour', 'complete'])
  })

  it('다음 굴림은 새 요청이라 다시 실행한다', () => {
    const ledger = createRollRequestLedger()
    const start = vi.fn()

    ledger.startOnce('r1', start)
    ledger.startOnce('r2', start)

    expect(start).toHaveBeenCalledTimes(2)
  })
})
