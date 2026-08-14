import { describe, expect, it } from 'vitest'
import { HeartbeatMonitor } from '../heartbeat.js'
import type { ClientSocket } from '../socket.js'

const socket = (): ClientSocket => ({ readyState: 1, send: () => {}, close: () => {} })

const monitorAt = (now: { value: number }): HeartbeatMonitor =>
  new HeartbeatMonitor({
    now: () => now.value,
    timeoutMs: 90_000,
    startScheduler: false,
  })

describe('HeartbeatMonitor', () => {
  it('제한 시간을 넘긴 뒤에만 끊는다 — 89_999ms는 생존한다', () => {
    const now = { value: 1_000 }
    const monitor = monitorAt(now)
    let timeouts = 0
    monitor.track(socket(), () => {
      timeouts += 1
    })

    now.value = 90_999
    monitor.sweep()
    expect(timeouts).toBe(0)

    // 두 번 쓸어도 콜백은 한 번이다 — 항목을 지우고 부르기 때문(멱등).
    now.value = 91_000
    monitor.sweep()
    monitor.sweep()
    expect(timeouts).toBe(1)
  })

  it('ping은 그 세션의 마감만 민다', () => {
    const now = { value: 1_000 }
    const monitor = monitorAt(now)
    const first = socket()
    const second = socket()
    let firstTimeouts = 0
    let secondTimeouts = 0
    monitor.track(first, () => {
      firstTimeouts += 1
    })
    monitor.track(second, () => {
      secondTimeouts += 1
    })

    now.value = 61_000
    monitor.recordPing(first)
    now.value = 91_000
    monitor.sweep()

    expect(firstTimeouts).toBe(0)
    expect(secondTimeouts).toBe(1)
  })

  it('추적을 멈춘 소켓은 끊지 않는다', () => {
    const now = { value: 1_000 }
    const monitor = monitorAt(now)
    const gone = socket()
    let timeouts = 0
    monitor.track(gone, () => {
      timeouts += 1
    })

    monitor.untrack(gone)
    // 이미 끊긴 소켓의 ping은 추적을 되살리지 않는다.
    monitor.recordPing(gone)
    now.value = 200_000
    monitor.sweep()

    expect(timeouts).toBe(0)
  })
})
