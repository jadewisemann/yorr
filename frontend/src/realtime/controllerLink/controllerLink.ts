import type { ControllerLinkSignal, PlayerId } from '@/realtime/wsEvents'
import { canRelay, PeerSession, RESTART_DELAY_MS } from './peerSession'
import type { ControllerLinkFrame, RelayableClientMessage } from './relay'

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
 *
 * 피어 내부 절차는 `peerSession.ts`, 채널 이름·초기화 옵션은 `linkChannels.ts`가 정본이다.
 */
export class ControllerLink {
  private readonly peers = new Map<PlayerId, PeerSession>()
  private closed = false

  constructor(private readonly options: ControllerLinkOptions) {}

  /** 열려 있는(둘 중 한 채널이라도 open인) 피어. */
  openPeerIds(): PlayerId[] {
    return [...this.peers.entries()].filter(([, session]) => session.open).map(([id]) => id)
  }

  /** 마지막으로 측정된 왕복 시간. 재는 쪽은 컨트롤러다. */
  rttMs(): number | null {
    for (const session of this.peers.values()) {
      const rtt = session.state.rttMs
      if (rtt !== null) return rtt
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
    if (this.closed || !canRelay(message)) return false
    let sent = false
    for (const session of this.peers.values()) {
      if (session.send(message)) sent = true
    }
    return sent
  }

  /** 상대가 보낸 협상 시그널. 명단보다 시그널이 먼저 와도 그 자리에서 피어를 만든다. */
  async accept(from: PlayerId, signal: ControllerLinkSignal) {
    if (this.closed) return
    const session = this.peers.get(from) ?? (await this.addPeer(from))
    if (!session) return

    if (signal.kind === 'candidate') {
      await session.addCandidate(signal.candidate)
      return
    }
    await session.applyRemoteDescription(signal.description)
  }

  close() {
    this.closed = true
    for (const id of [...this.peers.keys()]) this.dropPeer(id)
    this.options.onChanged()
  }

  /**
   * 피어를 만들고 **협상 전에 맵에 등록한다.** 등록이 먼저여야 offer를 만드는 동안
   * 도착한 시그널이 같은 id로 두 번째 피어를 만들지 않는다(중복 offer 차단).
   */
  private async addPeer(id: PlayerId): Promise<PeerSession | undefined> {
    if (this.closed) return undefined
    if (this.peers.has(id)) return this.peers.get(id)
    const session = new PeerSession(id, {
      role: this.options.role,
      iceServers: this.options.iceServers,
      sendSignal: (to, signal) => this.options.sendSignal(to, signal as ControllerLinkSignal),
      onFrame: (from, frame) => this.options.onFrame(from, frame),
      onChanged: () => this.options.onChanged(),
      onFailed: (peerId) => this.restartPeer(peerId),
      isClosed: () => this.closed,
    })
    this.peers.set(id, session)
    await session.start()
    return session
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
    const session = this.peers.get(id)
    if (!session) return
    this.peers.delete(id)
    session.close()
  }
}
