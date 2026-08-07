import type { PlayerId, VoiceSignalData } from '../wsEvents'

const RESTART_DELAY_MS = 2000

interface Peer {
  connection: RTCPeerConnection
  pendingCandidates: RTCIceCandidateInit[]
  audio: HTMLAudioElement
}

export interface VoiceMeshOptions {
  you: PlayerId
  iceServers: RTCIceServer[]
  localStream: MediaStream
  sendSignal: (to: PlayerId, data: VoiceSignalData) => void
  onPeersChanged: (peers: PlayerId[]) => void
}

export class VoiceMesh {
  private readonly peers = new Map<PlayerId, Peer>()
  private readonly mutedPeers = new Set<PlayerId>()
  private closed = false

  constructor(private readonly options: VoiceMeshOptions) {}

  peerIds(): PlayerId[] {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer.connection.connectionState === 'connected')
      .map(([id]) => id)
  }

  knownPeerIds(): PlayerId[] {
    return [...this.peers.keys()]
  }

  setPeerMuted(id: PlayerId, muted: boolean) {
    if (muted) this.mutedPeers.add(id)
    else this.mutedPeers.delete(id)
    const peer = this.peers.get(id)
    if (peer) peer.audio.muted = muted
  }

  mutedPeerIds(): PlayerId[] {
    return [...this.mutedPeers]
  }

  audioLevels(): Map<PlayerId, number> {
    const levels = new Map<PlayerId, number>()
    for (const [id, peer] of this.peers) {
      let peak = 0
      for (const receiver of peer.connection.getReceivers()) {
        if (receiver.track.kind !== 'audio') continue
        for (const source of receiver.getSynchronizationSources?.() ?? []) {
          peak = Math.max(peak, source.audioLevel ?? 0)
        }
      }
      levels.set(id, peak)
    }
    return levels
  }

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

  async accept(from: PlayerId, data: VoiceSignalData) {
    if (this.closed) return
    if (data.kind === 'input') return
    const peer = this.peers.get(from) ?? (await this.addPeer(from))
    if (!peer) return

    if (data.kind === 'candidate') {
      if (!peer.connection.remoteDescription) {
        peer.pendingCandidates.push(data.candidate)
        return
      }
      await this.safely(() => peer.connection.addIceCandidate(data.candidate))
      return
    }

    await this.safely(async () => {
      await peer.connection.setRemoteDescription(data.description)
      if (data.description.type === 'offer') {
        const answer = await peer.connection.createAnswer()
        await peer.connection.setLocalDescription(answer)
        this.options.sendSignal(from, { kind: 'description', description: answer })
      }
      await this.flushCandidates(peer)
    })
  }

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
    audio.hidden = true
    audio.setAttribute('aria-hidden', 'true')
    audio.muted = this.mutedPeers.has(id)
    document.body.append(audio)
    const peer: Peer = { audio, connection, pendingCandidates: [] }
    this.peers.set(id, peer)

    for (const track of this.options.localStream.getAudioTracks()) {
      connection.addTrack(track, this.options.localStream)
    }

    connection.addEventListener('track', (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
      void audio.play().catch(() => undefined)
      this.options.onPeersChanged(this.peerIds())
    })

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return
      this.options.sendSignal(id, { candidate: event.candidate.toJSON(), kind: 'candidate' })
    })

    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed') this.restartPeer(id)
      this.options.onPeersChanged(this.peerIds())
    })

    if (this.options.you < id) {
      await this.safely(async () => {
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        this.options.sendSignal(id, { description: offer, kind: 'description' })
      })
    }
    return peer
  }

  private restartPeer(id: PlayerId) {
    this.dropPeer(id)
    setTimeout(() => {
      if (this.closed || this.peers.has(id)) return
      void this.addPeer(id)
    }, RESTART_DELAY_MS)
  }

  private dropPeer(id: PlayerId) {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    peer.audio.srcObject = null
    peer.audio.remove()
    peer.connection.close()
  }

  private async flushCandidates(peer: Peer) {
    const queued = peer.pendingCandidates.splice(0)
    for (const candidate of queued) {
      await this.safely(() => peer.connection.addIceCandidate(candidate))
    }
  }

  private async safely(action: () => Promise<unknown> | unknown) {
    try {
      await action()
    } catch {}
  }
}
