import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './protocol.js'
import type { ClientSocket } from './socket.js'

interface TrackedSocket {
  readonly lastPingAt: number
  readonly onTimeout: () => void
}

export interface HeartbeatMonitorOptions {
  readonly now?: () => number
  readonly timeoutMs?: number
  readonly sweepIntervalMs?: number
  /** 테스트는 스케줄러를 끄고 `sweep()`을 직접 부른다. */
  readonly startScheduler?: boolean
}

/**
 * 세션별 마지막 하트비트를 추적하고 제한 시간을 넘긴 연결을 종료 경로로 보낸다. 실제 `sys.disconnect` 전송과 close는
 * 넘겨받은 콜백(게이트웨이)의 책임이다.
 */
export class HeartbeatMonitor {
  private readonly sockets = new Map<ClientSocket, TrackedSocket>()
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly timer: NodeJS.Timeout | null

  constructor(options: HeartbeatMonitorOptions = {}) {
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS
    const sweepIntervalMs = options.sweepIntervalMs ?? HEARTBEAT_INTERVAL_MS
    this.timer =
      options.startScheduler === false ? null : setInterval(() => this.sweep(), sweepIntervalMs)
    // 감시 타이머 하나 때문에 프로세스가 종료되지 못하면 안 된다.
    this.timer?.unref()
  }

  track(socket: ClientSocket, onTimeout: () => void): void {
    this.sockets.set(socket, { lastPingAt: this.now(), onTimeout })
  }

  /** 추적 중인 소켓만 갱신한다 — 이미 끊긴 소켓을 ping이 되살리지 않는다. */
  recordPing(socket: ClientSocket): void {
    const tracked = this.sockets.get(socket)
    if (!tracked) return
    this.sockets.set(socket, { lastPingAt: this.now(), onTimeout: tracked.onTimeout })
  }

  untrack(socket: ClientSocket): void {
    this.sockets.delete(socket)
  }

  /**
   * 경계는 정확히 `timeoutMs` **이상**이다(89_999ms는 생존).
   *
   * 삭제 전에 값이 그대로인지 다시 확인한다(CAS) —
   * 그 사이 도착한 ping이 이기면 살아 있는 세션을 끊지 않는다. 항목을 먼저
   * 지우므로 같은 세션에 콜백이 두 번 실행되지 않는다(멱등).
   */
  sweep(): void {
    const now = this.now()
    for (const [socket, tracked] of [...this.sockets]) {
      if (now - tracked.lastPingAt < this.timeoutMs) continue
      if (this.sockets.get(socket) !== tracked) continue
      this.sockets.delete(socket)
      tracked.onTimeout()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.sockets.clear()
  }
}
