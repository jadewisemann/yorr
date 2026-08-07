import { describe, expect, it, vi } from 'vitest'
import { createRollRequestLedger } from '@/yacht/model/roll/requestLedger'

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
