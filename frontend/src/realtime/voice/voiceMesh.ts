import type { PlayerId, VoiceSignalData } from '../wsEvents'

/**
 * WebRTC 풀메시 한 벌. React를 모른다 — 훅(useVoiceChat)이 이걸 감싸고 화면에 상태를 흘린다.
 *
 * 왜 라이브러리를 안 쓰는가: simple-peer·peerjs는 이 파일이 하는 일을 대신하지만, 아래
 * "누가 offer를 만드는가"와 "후보 큐"를 감춘다. 6인 메시에서 필요한 건 그 두 규칙이 전부고,
 * 감춰지면 문제가 생겼을 때 라이브러리 내부를 읽어야 한다.
 *
 * ── 규칙 1: offer는 playerId가 작은 쪽만 만든다
 *   양쪽이 동시에 offer를 보내면 협상이 깨진다(glare). 계약(wsEvents.ts)에 적힌 대로
 *   문자열 비교로 한쪽만 offer를 만들면 perfect negotiation의 복잡한 롤백이 필요 없다.
 *
 * ── 규칙 2: remote description 전에 온 ICE 후보는 큐에 쌓는다
 *   addIceCandidate는 remote description이 없으면 던진다. 그런데 상대의 후보는 offer/answer
 *   보다 먼저 도착할 수 있다(별개 메시지라 순서 보장이 없다). 큐가 없으면 통화가 간헐적으로
 *   안 붙고, 재현이 어려운 쪽으로 실패한다.
 *
 * ── 규칙 3: failed면 스스로 다시 협상한다
 *   명단(voice.peers)은 사람이 들락날락할 때만 온다. 죽은 연결을 버리고 기다리기만 하면
 *   명단이 다시 오지 않는 방에서는 영구히 "연결 중"이다. 폰은 화면 잠금·WiFi↔LTE 전환에서
 *   실제로 여기 걸린다.
 */

/**
 * failed를 보고 다시 만들기까지 기다리는 시간. 곧바로 다시 시도하면 아직 돌아오지 않은 망에서
 * 같은 실패를 그대로 밟는다.
 */
const RESTART_DELAY_MS = 2000

interface Peer {
  connection: RTCPeerConnection
  /** remote description이 아직 없어서 넣지 못한 후보들. 붙는 즉시 비운다(규칙 2). */
  pendingCandidates: RTCIceCandidateInit[]
  /** 상대 목소리를 재생하는 엘리먼트. DOM에 붙이지 않아도 play()로 소리가 난다. */
  audio: HTMLAudioElement
}

export interface VoiceMeshOptions {
  /** 내 playerId. offer 방향을 정하는 기준이다(규칙 1). */
  you: PlayerId
  iceServers: RTCIceServer[]
  localStream: MediaStream
  /** 시그널을 상대에게 보내 달라고 바깥(소켓)에 부탁한다. */
  sendSignal: (to: PlayerId, data: VoiceSignalData) => void
  /** 연결 상태가 바뀌었을 때 화면을 갱신하라고 알린다. */
  onPeersChanged: (peers: PlayerId[]) => void
}

export class VoiceMesh {
  private readonly peers = new Map<PlayerId, Peer>()
  /**
   * 내가 소리를 끈 상대. 연결이 아니라 여기(메시)가 들고 있어야 한다 — 상대가 잠깐 끊겼다
   * 돌아오면 새 RTCPeerConnection이 만들어지는데, 그때 다시 소리가 나면 껐던 뜻이 사라진다.
   */
  private readonly mutedPeers = new Set<PlayerId>()
  private closed = false

  constructor(private readonly options: VoiceMeshOptions) {}

  /**
   * 지금 **실제로 소리가 오가는** 상대들.
   *
   * 맵에 있는 전부가 아니라 connectionState가 connected인 것만 센다. addPeer는 협상을
   * 시작하기 전에 맵에 넣으므로, 맵 크기를 그대로 쓰면 아직 붙지 않은(또는 붙는 중인) 피어까지
   * "연결됨"으로 세어 화면이 거짓말을 한다. 협상 중에는 0명으로 보이는 게 정직하다 —
   * 버튼에 "연결 대기 중" 라벨이 이미 있다.
   */
  peerIds(): PlayerId[] {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer.connection.connectionState === 'connected')
      .map(([id]) => id)
  }

  /** 협상 중인 것까지 포함한 전체. 명단 diff(syncPeers)와 테스트가 쓴다. */
  knownPeerIds(): PlayerId[] {
    return [...this.peers.keys()]
  }

  /**
   * 특정 상대의 소리만 끈다("저 사람 목소리는 안 듣고 싶다").
   *
   * 연결은 그대로 두고 재생만 막는다 — 트랙을 끊으면 다시 들으려 할 때 재협상이 필요하고,
   * 상대에게도 연결이 끊긴 것처럼 보인다. audio.muted는 그 둘 다 건드리지 않는다.
   * 상대는 내가 자기 소리를 껐다는 사실을 알 수 없다(계약에 관련 메시지가 없다).
   */
  setPeerMuted(id: PlayerId, muted: boolean) {
    if (muted) this.mutedPeers.add(id)
    else this.mutedPeers.delete(id)
    const peer = this.peers.get(id)
    if (peer) peer.audio.muted = muted
  }

  /** 내가 소리를 끈 상대들. 재접속으로 연결이 새로 만들어져도 유지된다. */
  mutedPeerIds(): PlayerId[] {
    return [...this.mutedPeers]
  }

  /**
   * 상대별 현재 음량(0~1). "누가 말하는 중"을 그리는 데 쓴다.
   *
   * AudioContext + AnalyserNode를 세우지 않는다 — WebRTC 수신기가 이미 이 값을 갖고 있다
   * (`getSynchronizationSources().audioLevel`). 오디오 그래프를 따로 만들면 스트림마다
   * 노드가 붙고 정리 책임이 늘어나는데, 얻는 건 같은 숫자다.
   *
   * 내 음량은 재지 않는다. 수신기가 없어서 다른 경로가 필요하고, 내가 말하는 중인지는
   * 화면이 알려주지 않아도 본인이 안다.
   */
  audioLevels(): Map<PlayerId, number> {
    const levels = new Map<PlayerId, number>()
    for (const [id, peer] of this.peers) {
      let peak = 0
      for (const receiver of peer.connection.getReceivers()) {
        if (receiver.track.kind !== 'audio') continue
        // 브라우저에 따라 없을 수 있다. 없으면 0 — 표시만 안 되고 통화는 정상이다.
        for (const source of receiver.getSynchronizationSources?.() ?? []) {
          peak = Math.max(peak, source.audioLevel ?? 0)
        }
      }
      levels.set(id, peak)
    }
    return levels
  }

  /**
   * 서버가 준 음성 채널 명단에 맞춘다. 명단은 전체 스냅샷이라(계약대로) 여기서 diff를 낸다 —
   * 들어온 사람에게는 연결을 만들고, 빠진 사람의 연결은 닫는다. 나 자신은 건너뛴다.
   */
  syncPeers(roster: PlayerId[]) {
    if (this.closed) return
    const wanted = new Set(roster.filter((id) => id !== this.options.you))

    for (const id of this.peers.keys()) {
      if (!wanted.has(id)) this.dropPeer(id)
    }
    for (const id of wanted) {
      if (!this.peers.has(id)) void this.addPeer(id)
    }
    this.options.onPeersChanged(this.peerIds())
  }

  /** 상대가 보낸 시그널을 적용한다. 계약의 voice.signaled가 그대로 들어온다. */
  async accept(from: PlayerId, data: VoiceSignalData) {
    if (this.closed) return
    // 상대가 먼저 offer를 보내면 명단보다 시그널이 먼저 도착할 수 있다 — 그때도 연결을 만든다.
    const peer = this.peers.get(from) ?? (await this.addPeer(from))
    if (!peer) return

    if (data.kind === 'candidate') {
      // remote description이 아직 없으면 큐에 쌓는다(규칙 2).
      if (!peer.connection.remoteDescription) {
        peer.pendingCandidates.push(data.candidate)
        return
      }
      await this.safely(() => peer.connection.addIceCandidate(data.candidate))
      return
    }

    await this.safely(async () => {
      await peer.connection.setRemoteDescription(data.description)
      // offer를 받았으면 answer를 만들어 돌려준다. answer를 받았으면 여기서 끝이다.
      if (data.description.type === 'offer') {
        const answer = await peer.connection.createAnswer()
        await peer.connection.setLocalDescription(answer)
        this.options.sendSignal(from, { kind: 'description', description: answer })
      }
      await this.flushCandidates(peer)
    })
  }

  /** 통화 종료. 연결·트랙·오디오를 모두 정리한다 — 안 하면 마이크 표시등이 계속 켜져 있다. */
  close() {
    this.closed = true
    for (const id of [...this.peers.keys()]) this.dropPeer(id)
    this.options.onPeersChanged([])
  }

  private async addPeer(id: PlayerId): Promise<Peer | undefined> {
    if (this.closed) return undefined
    const connection = new RTCPeerConnection({ iceServers: this.options.iceServers })
    const audio = new Audio()
    audio.autoplay = true
    // DOM에 붙인다. 떼어놓은 엘리먼트로도 크롬에서는 소리가 나지만 iOS Safari는 미디어
    // 엘리먼트가 문서에 없으면 재생을 거부하는 경우가 있다 — 주 타깃이 모바일이라 붙여 둔다.
    // 화면에 보일 것은 없으므로 접근성 트리와 레이아웃에서 모두 빼낸다.
    audio.hidden = true
    audio.setAttribute('aria-hidden', 'true')
    // 껐던 상대가 재접속하면 연결이 새로 만들어진다 — 그때 소리가 다시 나면 안 된다.
    audio.muted = this.mutedPeers.has(id)
    document.body.append(audio)
    const peer: Peer = { audio, connection, pendingCandidates: [] }
    this.peers.set(id, peer)

    for (const track of this.options.localStream.getAudioTracks()) {
      connection.addTrack(track, this.options.localStream)
    }

    connection.addEventListener('track', (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
      // 자동재생 차단은 조용히 실패한다 — 마이크 권한을 이미 받은 컨텍스트라 보통 통과한다.
      void audio.play().catch(() => undefined)
      this.options.onPeersChanged(this.peerIds())
    })

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return
      this.options.sendSignal(id, { candidate: event.candidate.toJSON(), kind: 'candidate' })
    })

    connection.addEventListener('connectionstatechange', () => {
      // failed는 되살아나지 않는다 — 버리고 새로 만든다(규칙 3).
      // disconnected는 건드리지 않는다. 브라우저가 스스로 복구하는 경우가 많고, 못 하면 failed로 온다.
      if (connection.connectionState === 'failed') this.restartPeer(id)
      this.options.onPeersChanged(this.peerIds())
    })

    // 규칙 1 — 내 id가 작을 때만 offer를 만든다. 큰 쪽은 상대 offer를 기다린다.
    if (this.options.you < id) {
      await this.safely(async () => {
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        this.options.sendSignal(id, { description: offer, kind: 'description' })
      })
    }
    return peer
  }

  /**
   * 죽은 연결을 버리고 처음부터 다시 협상한다(규칙 3).
   *
   * ICE restart(`createOffer({ iceRestart: true })`)를 쓰지 않는 이유: 재시작은 offer를 만드는
   * 쪽만 할 수 있는데(규칙 1) 실패를 먼저 알아채는 쪽은 그 반대일 수 있다. 양쪽이 각자 연결을
   * 새로 만들면 어느 쪽이 먼저 깨닫든 같은 경로로 복구된다 — 상대가 아직 살아 있다고 믿고
   * 있어도 consent freshness(RFC 7675)로 30초 안에 같이 failed가 되고, 그때 작은 쪽이 offer한다.
   *
   * 재시도 횟수를 세지 않는다. 폰이 돌아왔을 때 스스로 붙는 게 중요하고, 포기해 버리면 사용자가
   * 통화를 껐다 켜야 한다. 실패 한 번에 ICE 타임아웃(수 초~수십 초)이 이미 들어 있어 반복이
   * 촘촘해지지도 않는다.
   */
  private restartPeer(id: PlayerId) {
    this.dropPeer(id)
    setTimeout(() => {
      // 그 사이 통화를 끄거나(closed) 명단이 이미 다시 만들어 줬으면 아무것도 하지 않는다.
      // 상대가 정말 나갔다면 leave가 뿌린 명단이 곧 이 연결을 다시 걷어간다.
      if (this.closed || this.peers.has(id)) return
      void this.addPeer(id)
    }, RESTART_DELAY_MS)
  }

  private dropPeer(id: PlayerId) {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    peer.audio.srcObject = null
    // DOM에 붙였으니 반드시 뗀다 — 안 떼면 통화를 켜고 끌 때마다 빈 audio가 쌓인다.
    peer.audio.remove()
    peer.connection.close()
  }

  private async flushCandidates(peer: Peer) {
    const queued = peer.pendingCandidates.splice(0)
    for (const candidate of queued) {
      await this.safely(() => peer.connection.addIceCandidate(candidate))
    }
  }

  /**
   * 시그널 하나가 실패해도 통화 전체를 죽이지 않는다. 협상 중 상대가 나가거나 순서가 어긋나면
   * 여기로 떨어지는데, 남은 피어들과의 통화는 그대로 유지돼야 한다.
   */
  private async safely(action: () => Promise<unknown> | unknown) {
    try {
      await action()
    } catch {
      // 실패한 시그널은 버린다 — 상태는 다음 voice.peers나 다음 후보에서 복구된다.
    }
  }
}
