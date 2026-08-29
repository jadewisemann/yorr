import type { ControllerLinkSignal, PlayerId } from '@/realtime/wsEvents'
import {
  type ControllerLinkFrame,
  isRelayable,
  parseFrame,
  type RelayableClientMessage,
} from './relay'

/**
 * 연결이 죽은 뒤 다시 협상하기까지의 유예. 음성 메시(`voiceMesh.ts`)와 같은 값이다 —
 * 폰이 화면 잠금·WiFi↔LTE 전환에서 실제로 여기 걸리고, 즉시 재시도하면 아직 정리되지
 * 않은 소켓 위에 새 협상을 얹는다.
 */
/**
 * 링크의 ICE 설정. **STUN만 쓰고 TURN을 붙이지 않는다.**
 *
 * TURN 중계를 타면 경로가 `폰 → TURN → TV`가 되어 이 링크가 없애려던 서버 홉이 그대로
 * 되살아난다. WebSocket 폴백이 같은 홉 수로 이미 같은 일을 하므로, TURN은 대역폭과
 * coturn 운영과 포트 개방을 지불하고 얻는 것이 없다(`docs/llmwiki/controller-link.md`).
 *
 * 발급 엔드포인트(`GET /voice/ice`)를 되살리지 않고 상수로 박는다 — STUN은 트래픽이
 * 지나가지 않아 자격이 필요 없고, 왕복 한 번을 링크 수립 앞에 두면 그만큼 늦게 붙는다.
 * 붙지 않는 망에서는 조용히 WebSocket으로 폴백한다.
 */
export const CONTROLLER_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

const RESTART_DELAY_MS = 2000

/** RTT 측정 주기. 게임 중에도 도는 keepalive라 촘촘하게 둘 이유가 없다. */
const PROBE_INTERVAL_MS = 2000

/**
 * 채널 두 개를 나눈 기준: **유실돼도 다음 것이 덮는 신호는 unreliable, 한 번뿐인 신호는
 * reliable.** 흔들림 펄스는 60ms마다 새로 오므로 늦게 도착한 옛 펄스가 오히려 해롭고,
 * 던지기는 놓치면 대시보드의 사발이 제때 쏟아지지 않는다.
 */
const PULSE_CHANNEL = 'yorr.ctrl.pulse'
const EVENT_CHANNEL = 'yorr.ctrl.event'

/**
 * 흔들림 펄스만 unreliable이다. 던지기와 탁구 스윙은 **한 번뿐인 신호**라 놓치면
 * 대시보드가 그 입력을 영영 모른다.
 */
const channelFor = (type: RelayableClientMessage['type']) =>
  type === 'game.yacht_dice.dice.shake' ? PULSE_CHANNEL : EVENT_CHANNEL

/** 흔들림 펄스: 재전송 없음 + 순서 없음. TCP의 head-of-line blocking을 피하는 자리다. */
const PULSE_INIT: RTCDataChannelInit = { ordered: false, maxRetransmits: 0 }

/** 던지기: 재전송은 하되 순서는 강제하지 않는다 — 앞선 펄스를 기다릴 이유가 없다. */
const EVENT_INIT: RTCDataChannelInit = { ordered: false }

const isOpen = (channel: RTCDataChannel) => channel.readyState === 'open'

function trySend(channel: RTCDataChannel, frame: ControllerLinkFrame) {
  try {
    channel.send(JSON.stringify(frame))
  } catch {}
}

async function safely(action: () => Promise<unknown> | unknown) {
  try {
    await action()
  } catch {}
}

/**
 * 링크의 두 역할. **대시보드가 offer를 만든다.**
 *
 * 서버가 파티 대시보드를 방 스냅샷의 플레이어 명단에 넣지 않으므로 **폰은 대시보드의
 * playerId를 알 방법이 없고**, 반대로 대시보드는 스냅샷에서 폰들의 id를 본다. 그래서
 * "id가 작은 쪽이 offer한다" 같은 대칭 규칙을 쓸 수 없다. 역할이 비대칭인 덕에 양쪽이
 * 동시에 offer하는 glare가 아예 생기지 않아 perfect negotiation의 롤백도 필요 없다.
 */
export type ControllerLinkRole = 'dashboard' | 'controller'

export interface ControllerLinkOptions {
  role: ControllerLinkRole
  iceServers: RTCIceServer[]
  sendSignal: (to: PlayerId, signal: ControllerLinkSignal) => void
  onFrame: (from: PlayerId, frame: ControllerLinkFrame) => void
  /** 열린 피어 수·RTT가 바뀔 때. 화면에 노출하는 값이 아니라 관측용이다. */
  onChanged: () => void
}

interface Peer {
  connection: RTCPeerConnection
  channels: Map<string, RTCDataChannel>
  pendingCandidates: RTCIceCandidateInit[]
  rttMs: number | null
  probe: ReturnType<typeof setInterval> | null
}

/**
 * 파티 대시보드와 컨트롤러 폰 사이의 DataChannel 연결을 관리한다. 대시보드를 중심에 둔
 * 별 모양이고, 폰 쪽 피어는 언제나 하나(대시보드)다.
 *
 * 라이브러리(simple-peer 등)를 쓰지 않는다 — "누가 offer를 만드는가"와 "후보 큐"를 감추기
 * 때문이고, 이 파일에서 실제로 중요한 것이 그 둘이다. 규칙 셋:
 *
 * 1. **offer는 대시보드만 만든다**(위 `ControllerLinkRole`).
 * 2. **remote description 전에 온 ICE 후보는 큐에 쌓았다가 flush한다.** 큐가 없으면
 *    링크가 간헐적으로, 재현이 어려운 쪽으로 안 붙는다.
 * 3. **failed면 대시보드가 다시 협상한다**(2초 뒤). 폰은 버리고 기다린다.
 */
export class ControllerLink {
  private readonly peers = new Map<PlayerId, Peer>()
  private closed = false

  constructor(private readonly options: ControllerLinkOptions) {}

  /** 열려 있는(둘 중 한 채널이라도 open인) 피어. */
  openPeerIds(): PlayerId[] {
    return [...this.peers.entries()]
      .filter(([, peer]) => [...peer.channels.values()].some((channel) => isOpen(channel)))
      .map(([id]) => id)
  }

  /** 마지막으로 측정된 왕복 시간. 재는 쪽은 컨트롤러다. */
  rttMs(): number | null {
    for (const peer of this.peers.values()) {
      if (peer.rttMs !== null) return peer.rttMs
    }
    return null
  }

  /**
   * 대시보드가 스냅샷 명단에 맞춰 피어를 맞춘다. 컨트롤러 쪽은 부르지 않는다 —
   * 폰은 상대 id를 모르고, 대시보드가 먼저 signal을 보내는 순간 `accept`가 피어를 만든다.
   */
  syncPeers(roster: PlayerId[]) {
    if (this.closed || this.options.role !== 'dashboard') return
    const wanted = new Set(roster)
    for (const id of [...this.peers.keys()]) {
      if (!wanted.has(id)) this.dropPeer(id)
    }
    for (const id of wanted) {
      if (!this.peers.has(id)) void this.addPeer(id)
    }
    this.options.onChanged()
  }

  /**
   * 릴레이 프레임을 채널로 보낸다. **보냈으면 true** — 호출부는 false일 때 WebSocket으로
   * 폴백한다. 폴백 판정을 링크 안에 감추지 않는 이유는, 감추면 "무엇이 서버를 거쳤는가"가
   * 호출부에서 안 보이기 때문이다.
   */
  send(message: RelayableClientMessage): boolean {
    if (this.closed || !isRelayable(message)) return false
    const label = channelFor(message.type)
    let sent = false
    for (const peer of this.peers.values()) {
      const channel = peer.channels.get(label)
      if (!channel || !isOpen(channel)) continue
      try {
        channel.send(JSON.stringify({ kind: 'relay', message } satisfies ControllerLinkFrame))
        sent = true
      } catch {}
    }
    return sent
  }

  /** 상대가 보낸 협상 시그널. 명단보다 시그널이 먼저 와도 그 자리에서 피어를 만든다. */
  async accept(from: PlayerId, signal: ControllerLinkSignal) {
    if (this.closed) return
    const peer = this.peers.get(from) ?? (await this.addPeer(from))
    if (!peer) return

    if (signal.kind === 'candidate') {
      if (!peer.connection.remoteDescription) {
        peer.pendingCandidates.push(signal.candidate)
        return
      }
      await safely(() => peer.connection.addIceCandidate(signal.candidate))
      return
    }

    await safely(async () => {
      await peer.connection.setRemoteDescription(signal.description)
      if (signal.description.type === 'offer') {
        const answer = await peer.connection.createAnswer()
        await peer.connection.setLocalDescription(answer)
        this.options.sendSignal(from, { kind: 'description', description: answer })
      }
      const queued = peer.pendingCandidates.splice(0)
      for (const candidate of queued) {
        await safely(() => peer.connection.addIceCandidate(candidate))
      }
    })
  }

  close() {
    this.closed = true
    for (const id of [...this.peers.keys()]) this.dropPeer(id)
    this.options.onChanged()
  }

  private async addPeer(id: PlayerId): Promise<Peer | undefined> {
    if (this.closed) return undefined
    const connection = new RTCPeerConnection({ iceServers: this.options.iceServers })
    const peer: Peer = {
      connection,
      channels: new Map(),
      pendingCandidates: [],
      rttMs: null,
      probe: null,
    }
    this.peers.set(id, peer)

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return
      this.options.sendSignal(id, {
        kind: 'candidate',
        candidate: event.candidate.toJSON(),
      })
    })

    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed') this.restartPeer(id)
      this.options.onChanged()
    })

    if (this.options.role === 'dashboard') {
      // 채널은 offer를 만들기 전에 열어야 SDP에 실린다.
      this.attachChannel(id, peer, connection.createDataChannel(PULSE_CHANNEL, PULSE_INIT))
      this.attachChannel(id, peer, connection.createDataChannel(EVENT_CHANNEL, EVENT_INIT))
      await safely(async () => {
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        this.options.sendSignal(id, { kind: 'description', description: offer })
      })
      return peer
    }

    connection.addEventListener('datachannel', (event) => {
      this.attachChannel(id, peer, event.channel)
    })
    return peer
  }

  private attachChannel(id: PlayerId, peer: Peer, channel: RTCDataChannel) {
    peer.channels.set(channel.label, channel)
    channel.addEventListener('open', () => {
      if (channel.label === EVENT_CHANNEL) this.startProbe(peer, channel)
      this.options.onChanged()
    })
    channel.addEventListener('close', () => this.options.onChanged())
    channel.addEventListener('message', (event) => {
      const frame = parseFrame((event as MessageEvent).data)
      if (!frame) return
      if (frame.kind === 'ping') {
        trySend(channel, { kind: 'pong', sentAt: frame.sentAt })
        return
      }
      if (frame.kind === 'pong') {
        peer.rttMs = Math.max(0, Date.now() - frame.sentAt)
        this.options.onChanged()
        return
      }
      this.options.onFrame(id, frame)
    })
  }

  /**
   * 왕복 시간은 **컨트롤러가** 잰다 — 지연을 겪는 쪽이 폰이고, 폴백을 판단하는 코드도
   * 폰에 있다. 대시보드는 받은 ping을 그대로 되돌려 주기만 한다.
   */
  private startProbe(peer: Peer, channel: RTCDataChannel) {
    if (this.options.role !== 'controller' || peer.probe) return
    const tick = () => {
      if (!isOpen(channel)) return
      trySend(channel, { kind: 'ping', sentAt: Date.now() })
    }
    tick()
    peer.probe = setInterval(tick, PROBE_INTERVAL_MS)
  }

  /**
   * 재협상은 **대시보드만** 할 수 있다(offer 주체가 하나뿐이다). 폰은 피어를 버리고
   * 기다린다 — consent freshness(RFC 7675)로 대시보드도 30초 안에 같이 failed가 되고,
   * 그쪽이 다시 offer한다. ICE restart를 쓰지 않는 이유도 같다: 재시작은 offer를 만드는
   * 쪽만 할 수 있는데 실패를 먼저 알아채는 쪽은 폰일 수 있다.
   */
  private restartPeer(id: PlayerId) {
    this.dropPeer(id)
    if (this.options.role !== 'dashboard') return
    setTimeout(() => {
      if (this.closed || this.peers.has(id)) return
      void this.addPeer(id)
    }, RESTART_DELAY_MS)
  }

  private dropPeer(id: PlayerId) {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    if (peer.probe) clearInterval(peer.probe)
    for (const channel of peer.channels.values()) {
      try {
        channel.close()
      } catch {}
    }
    peer.connection.close()
  }
}
