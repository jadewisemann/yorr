import type { PlayerId } from '@/realtime/wsEvents'
import {
  channelFor,
  EVENT_CHANNEL,
  EVENT_INIT,
  isOpen,
  PULSE_CHANNEL,
  PULSE_INIT,
  safely,
  trySend,
} from './linkChannels'
import {
  type ControllerLinkFrame,
  isRelayable,
  parseFrame,
  type RelayableClientMessage,
} from './relay'

/**
 * 피어 하나의 **수명** — RTCPeerConnection 생성, 채널 부착, 후보 큐, 재협상.
 *
 * `controllerLink.ts`에서 갈라 둔 이유: 링크 클래스는 "명단에 맞춰 피어를 맞춘다"는
 * 조정만 하고, 피어 내부의 협상 절차는 이 파일이 안다. 후보 큐 규칙(remote description
 * 전에는 쌓아 둔다)은 이 링크가 간헐적으로 안 붙던 원인이라 주석째 옮겼다.
 */

/** 왕복 시간 측정 주기. 게임 중에도 도는 keepalive라 촘촘하게 둘 이유가 없다. */
export const PROBE_INTERVAL_MS = 2000

/** 연결이 죽은 뒤 다시 협상하기까지의 유예. 음성 메시와 같은 값이다. */
export const RESTART_DELAY_MS = 2000

export interface Peer {
  connection: RTCPeerConnection
  channels: Map<string, RTCDataChannel>
  pendingCandidates: RTCIceCandidateInit[]
  rttMs: number | null
  probe: ReturnType<typeof setInterval> | null
}

export type ControllerLinkRole = 'dashboard' | 'controller'

export interface PeerHooks {
  readonly role: ControllerLinkRole
  readonly iceServers: RTCIceServer[]
  readonly sendSignal: (to: PlayerId, signal: unknown) => void
  readonly onFrame: (from: PlayerId, frame: ControllerLinkFrame) => void
  readonly onChanged: () => void
  /** failed 상태를 감지했을 때 — 링크가 재협상 예약을 맡는다. */
  readonly onFailed: (id: PlayerId) => void
  readonly isClosed: () => boolean
}

export class PeerSession {
  readonly state: Peer

  constructor(
    readonly id: PlayerId,
    private readonly hooks: PeerHooks,
  ) {
    const connection = new RTCPeerConnection({ iceServers: hooks.iceServers })
    this.state = {
      connection,
      channels: new Map(),
      pendingCandidates: [],
      rttMs: null,
      probe: null,
    }

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return
      hooks.sendSignal(id, { kind: 'candidate', candidate: event.candidate.toJSON() })
    })

    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed') hooks.onFailed(id)
      hooks.onChanged()
    })

    if (hooks.role === 'controller') {
      connection.addEventListener('datachannel', (event) => this.attach(event.channel))
    }
  }

  /**
   * 협상을 시작한다. **맵에 등록된 뒤에 불러야 한다** — offer를 만드는 동안
   * `accept`가 같은 id로 들어오면 중복 피어가 생기고 신호가 두 번 나간다.
   * 대시보드만 offer를 만든다(역할 비대칭).
   */
  async start(): Promise<void> {
    if (this.hooks.role !== 'dashboard') return
    const connection = this.state.connection
    // 채널은 offer를 만들기 전에 열어야 SDP에 실린다.
    this.attach(connection.createDataChannel(PULSE_CHANNEL, PULSE_INIT))
    this.attach(connection.createDataChannel(EVENT_CHANNEL, EVENT_INIT))
    await safely(async () => {
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      this.hooks.sendSignal(this.id, { kind: 'description', description: offer })
    })
  }

  /** 둘 중 한 채널이라도 열려 있는가. */
  get open(): boolean {
    return [...this.state.channels.values()].some((channel) => isOpen(channel))
  }

  /** 릴레이 프레임을 해당 채널로 보낸다. 보냈으면 true(호출부가 WS 폴백을 판단한다). */
  send(message: RelayableClientMessage): boolean {
    const channel = this.state.channels.get(channelFor(message.type))
    if (!channel || !isOpen(channel)) return false
    try {
      channel.send(JSON.stringify({ kind: 'relay', message } satisfies ControllerLinkFrame))
      return true
    } catch {
      return false
    }
  }

  /** 후보를 붙인다. remote description 전이면 큐에 쌓아 둔다(규칙 2). */
  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.state.connection.remoteDescription) {
      this.state.pendingCandidates.push(candidate)
      return
    }
    await safely(() => this.state.connection.addIceCandidate(candidate))
  }

  /** 원격 설명 적용. offer면 answer를 만들어 되돌려 보낸다. */
  async applyRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    await safely(async () => {
      await this.state.connection.setRemoteDescription(description)
      if (description.type === 'offer') {
        const answer = await this.state.connection.createAnswer()
        await this.state.connection.setLocalDescription(answer)
        this.hooks.sendSignal(this.id, { kind: 'description', description: answer })
      }
      const queued = this.state.pendingCandidates.splice(0)
      for (const candidate of queued) {
        await safely(() => this.state.connection.addIceCandidate(candidate))
      }
    })
  }

  close(): void {
    if (this.state.probe) clearInterval(this.state.probe)
    for (const channel of this.state.channels.values()) {
      try {
        channel.close()
      } catch {}
    }
    this.state.connection.close()
  }

  private attach(channel: RTCDataChannel): void {
    this.state.channels.set(channel.label, channel)
    channel.addEventListener('open', () => {
      if (channel.label === EVENT_CHANNEL) this.startProbe(channel)
      this.hooks.onChanged()
    })
    channel.addEventListener('close', () => this.hooks.onChanged())
    channel.addEventListener('message', (event) => this.receive(channel, event))
  }

  private receive(channel: RTCDataChannel, event: Event): void {
    const frame = parseFrame((event as MessageEvent).data)
    if (!frame) return
    if (frame.kind === 'ping') {
      trySend(channel, { kind: 'pong', sentAt: frame.sentAt })
      return
    }
    if (frame.kind === 'pong') {
      this.state.rttMs = Math.max(0, Date.now() - frame.sentAt)
      this.hooks.onChanged()
      return
    }
    this.hooks.onFrame(this.id, frame)
  }

  /**
   * 왕복 시간은 **컨트롤러가** 잰다 — 지연을 겪는 쪽이 폰이고, 폴백을 판단하는 코드도
   * 폰에 있다. 대시보드는 받은 ping을 그대로 되돌려 주기만 한다.
   */
  private startProbe(channel: RTCDataChannel): void {
    if (this.hooks.role !== 'controller' || this.state.probe) return
    const tick = () => {
      if (!isOpen(channel)) return
      trySend(channel, { kind: 'ping', sentAt: Date.now() })
    }
    tick()
    this.state.probe = setInterval(tick, PROBE_INTERVAL_MS)
  }
}

/** 릴레이 메시지인지만 링크가 확인한다 — 보낼 수 없는 것은 false다. */
export const canRelay = (message: RelayableClientMessage): boolean => isRelayable(message)
