import { WebSocket } from 'ws'

/** 서버가 보내는 봉투. 모양이 이것과 다르면 `malformed`에 쌓인다(퍼저의 불변식). */
export interface Envelope {
  readonly type: string
  readonly ts: number
  readonly payload: unknown
  readonly roomId?: string
  readonly msgId?: string
}

export interface SendExtra {
  readonly roomId?: string
  /** 생략하면 자동으로 붙인다. `null`이면 싣지 않는다. */
  readonly msgId?: string | null
}

/**
 * 응답을 기다리는 기본 시간. 장애 주입 스윕처럼 "응답이 오지 않는 것"이 정상인 테스트는
 * 이 값을 줄여 반복 시간을 줄인다(`setDefaultWaitMs`).
 */
let defaultWaitMs = 5_000

export const setDefaultWaitMs = (ms: number): void => {
  defaultWaitMs = ms
}

const isEnvelope = (value: unknown): value is Envelope => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.type === 'string' &&
    candidate.type.length > 0 &&
    typeof candidate.ts === 'number' &&
    'payload' in candidate &&
    (candidate.roomId === undefined || typeof candidate.roomId === 'string') &&
    (candidate.msgId === undefined || typeof candidate.msgId === 'string')
  )
}

/**
 * 진짜 소켓 하나. **받은 메시지를 소비형 큐로 다룬다** — `next(type)`은 아직 소비하지 않은
 * 그 타입의 가장 이른 메시지를 돌려주고 소비한다. 같은 타입이 여러 번 오는 흐름(굴림마다
 * 다시 오는 `round.start`)을 순서대로 짚으려면 "처음 받은 것"을 찾는 방식으로는 안 된다.
 */
export class WsClient {
  readonly received: Envelope[] = []
  /** 봉투 모양이 아닌 프레임 원문. 서버가 하나라도 보냈다면 계약 위반이다. */
  readonly malformed: string[] = []
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>
  private readonly consumed = new Set<number>()
  private readonly wakers = new Set<() => void>()
  private readonly socket: WebSocket
  private readonly label: string
  private sequence = 0

  private constructor(socket: WebSocket, label: string) {
    this.socket = socket
    this.label = label
    this.closed = new Promise((resolve) => {
      socket.once('close', (code, reason) => {
        this.wakeAll()
        resolve({ code, reason: reason.toString() })
      })
    })
    socket.on('message', (raw, isBinary) => this.accept(raw.toString(), isBinary))
  }

  static async open(url: string, label: string, origin?: string): Promise<WsClient> {
    const socket = new WebSocket(url, origin === undefined ? {} : { origin })
    const client = new WsClient(socket, label)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    // 서버가 끊는 쪽의 소켓 오류는 `closed`로 관찰한다 — 테스트 워커를 죽이지 않게 한다.
    socket.on('error', () => {})
    return client
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN
  }

  /** 봉투를 만들어 보낸다. 붙인 msgId를 돌려준다(응답 짝 맞추기용). */
  send(type: string, payload: unknown, extra: SendExtra = {}): string | undefined {
    const msgId =
      extra.msgId === null ? undefined : (extra.msgId ?? `${this.label}-${++this.sequence}`)
    this.sendRaw(
      JSON.stringify({
        type,
        ts: Date.now(),
        payload,
        ...(extra.roomId === undefined ? {} : { roomId: extra.roomId }),
        ...(msgId === undefined ? {} : { msgId }),
      }),
    )
    return msgId
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.socket.send(data, { binary })
  }

  /**
   * 아직 소비하지 않은 메시지 중 `types`에 들고 `accept`를 만족하는 가장 이른 것.
   * 오지 않으면 받은 타입 목록을 담아 실패한다 — 프로토콜 흐름이 어디서 끊겼는지 보인다.
   */
  async next(
    types: string | readonly string[],
    accept: (message: Envelope) => boolean = () => true,
    timeoutMs = defaultWaitMs,
  ): Promise<Envelope> {
    const wanted = typeof types === 'string' ? [types] : types
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const index = this.received.findIndex(
        (message, position) =>
          !this.consumed.has(position) && wanted.includes(message.type) && accept(message),
      )
      const found = this.received[index]
      if (found !== undefined) {
        this.consumed.add(index)
        return found
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0 || !this.isOpen) {
        throw new Error(
          `${this.label}: ${wanted.join(' | ')}를 ${timeoutMs}ms 안에 받지 못했다 ` +
            `(소켓 ${this.isOpen ? '열림' : '닫힘'}). 받은 것: ${this.recentTypes()}`,
        )
      }
      await this.waitForAnything(remaining)
    }
  }

  /** `withinMs` 동안 그 타입이 오지 **않았음**을 확인한다(무음 드롭 계약용). */
  async expectSilence(type: string, withinMs = 300): Promise<void> {
    const before = this.received.length
    await new Promise((resolve) => setTimeout(resolve, withinMs))
    const arrived = this.received.slice(before).filter((message) => message.type === type)
    if (arrived.length > 0) {
      throw new Error(`${this.label}: ${type}가 오지 않아야 했는데 ${arrived.length}건 왔다`)
    }
  }

  /** 소비 여부와 무관하게 지금까지 받은 그 타입 전부. */
  all(type: string): Envelope[] {
    return this.received.filter((message) => message.type === type)
  }

  async close(): Promise<void> {
    if (this.isOpen) this.socket.close()
    await this.closed
  }

  /** 네트워크가 끊긴 것처럼 닫는다(close 프레임 없음). */
  terminate(): void {
    this.socket.terminate()
  }

  private accept(text: string, isBinary: boolean): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
    if (isBinary || !isEnvelope(parsed)) {
      this.malformed.push(text.slice(0, 200))
    } else {
      this.received.push(parsed)
    }
    this.wakeAll()
  }

  private waitForAnything(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer)
        this.wakers.delete(wake)
        resolve()
      }
      const timer = setTimeout(wake, timeoutMs)
      this.wakers.add(wake)
    })
  }

  private wakeAll(): void {
    for (const wake of [...this.wakers]) wake()
  }

  private recentTypes(): string {
    return (
      this.received
        .slice(-15)
        .map((message) => message.type)
        .join(', ') || '(없음)'
    )
  }
}
