import { vi } from 'vitest'

/**
 * 컨트롤러 링크 테스트용 WebRTC 스텁. jsdom에는 `RTCPeerConnection`이 없고, 링크가
 * 검증해야 하는 것은 SDP가 아니라 **협상 순서와 채널 선택**이라 실물이 필요 없다.
 *
 * (음성 메시 테스트는 미디어 트랙·`<audio>`까지 필요해 자기 스텁을 따로 들고 있다.)
 */
/** 이벤트 대상 노릇을 하는 최소 구현. 가짜 채널과 가짜 연결이 함께 쓴다. */
class Listeners {
  private readonly byType = new Map<string, Set<(event: unknown) => void>>()

  add(type: string, listener: (event: unknown) => void) {
    const set = this.byType.get(type) ?? new Set()
    set.add(listener)
    this.byType.set(type, set)
  }

  fire(type: string, event: unknown) {
    for (const listener of this.byType.get(type) ?? []) listener(event)
  }
}

export class FakeDataChannel {
  readyState = 'connecting'
  readonly sent: string[] = []
  private readonly listeners = new Listeners()

  constructor(
    readonly label: string,
    readonly init?: RTCDataChannelInit,
  ) {}

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.add(type, listener)
  }

  send(data: string) {
    if (this.readyState !== 'open') throw new Error('channel is not open')
    this.sent.push(data)
  }

  close() {
    this.readyState = 'closed'
  }

  /** 채널이 실제로 열린 순간. 이 전에는 링크가 `send`에서 false를 돌려줘야 한다. */
  open() {
    this.readyState = 'open'
    this.fire('open', {})
  }

  receive(frame: unknown) {
    this.fire('message', { data: JSON.stringify(frame) })
  }

  frames(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw))
  }

  private fire(type: string, event: unknown) {
    this.listeners.fire(type, event)
  }
}

export interface FakeConnection {
  channels: FakeDataChannel[]
  remoteDescription: object | null
  connectionState: string
  addIceCandidate: ReturnType<typeof vi.fn>
  fire: (type: string, event: unknown) => void
}

/** 만들어진 연결들. `stubWebRtc()`가 매번 비운다. */
export const rtcConnections: FakeConnection[] = []

export function stubWebRtc() {
  rtcConnections.length = 0
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      channels: FakeDataChannel[] = []
      remoteDescription: object | null = null
      connectionState = 'new'
      private readonly listeners = new Listeners()

      addIceCandidate = vi.fn(async () => undefined)
      createOffer = vi.fn(async () => ({ sdp: 'offer-sdp', type: 'offer' as const }))
      createAnswer = vi.fn(async () => ({ sdp: 'answer-sdp', type: 'answer' as const }))
      setLocalDescription = vi.fn(async () => undefined)
      setRemoteDescription = vi.fn(async (description: object) => {
        this.remoteDescription = description
      })
      close = vi.fn()

      constructor() {
        rtcConnections.push(this as unknown as FakeConnection)
      }

      createDataChannel(label: string, init?: RTCDataChannelInit) {
        const channel = new FakeDataChannel(label, init)
        this.channels.push(channel)
        return channel as unknown as RTCDataChannel
      }

      addEventListener(type: string, listener: (event: unknown) => void) {
        this.listeners.add(type, listener)
      }

      fire(type: string, event: unknown) {
        this.listeners.fire(type, event)
      }
    },
  )
}
