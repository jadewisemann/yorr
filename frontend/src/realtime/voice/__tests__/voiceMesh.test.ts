import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerId, VoiceSignalData } from '../../wsEvents'
import { VoiceMesh } from '../voiceMesh'

interface FakeConnection {
  addEventListener: ReturnType<typeof vi.fn>
  addIceCandidate: ReturnType<typeof vi.fn>
  setRemoteDescription: ReturnType<typeof vi.fn>
  createOffer: ReturnType<typeof vi.fn>
  createAnswer: ReturnType<typeof vi.fn>
  setLocalDescription: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  remoteDescription: object | null
  connectionState: string
}

const connections: FakeConnection[] = []

function stubWebRtc() {
  connections.length = 0
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      remoteDescription: object | null = null
      connectionState = 'new'
      addIceCandidate = vi.fn(async () => undefined)
      createOffer = vi.fn(async () => ({ sdp: 'offer-sdp', type: 'offer' as const }))
      createAnswer = vi.fn(async () => ({ sdp: 'answer-sdp', type: 'answer' as const }))
      setLocalDescription = vi.fn(async () => undefined)
      setRemoteDescription = vi.fn(async (description: object) => {
        this.remoteDescription = description
      })
      addTrack = vi.fn()
      addEventListener = vi.fn()
      close = vi.fn()
      getReceivers = vi.fn(() => [])
      constructor() {
        connections.push(this as unknown as FakeConnection)
      }
    },
  )
  vi.stubGlobal('Audio', function FakeAudio() {
    const element = document.createElement('audio')
    element.play = vi.fn(async () => undefined)
    return element
  })
}

function fireStateChange(connection: FakeConnection, state: string) {
  connection.connectionState = state
  for (const [type, listener] of connection.addEventListener.mock.calls) {
    if (type === 'connectionstatechange') (listener as () => void)()
  }
}

function createMesh(you: PlayerId) {
  const sent: Array<{ to: PlayerId; data: VoiceSignalData }> = []
  const mesh = new VoiceMesh({
    iceServers: [],
    localStream: { getAudioTracks: () => [] } as unknown as MediaStream,
    onPeersChanged: () => undefined,
    sendSignal: (to, data) => sent.push({ data, to }),
    you,
  })
  return { mesh, sent }
}

describe('VoiceMesh', () => {
  beforeEach(stubWebRtc)

  it('내 id가 작으면 offer를 만들어 보낸다', async () => {
    const { mesh, sent } = createMesh('aaa')

    mesh.syncPeers(['aaa', 'zzz'])
    await vi.waitFor(() => expect(sent).toHaveLength(1))

    expect(sent[0]).toEqual({
      data: { description: { sdp: 'offer-sdp', type: 'offer' }, kind: 'description' },
      to: 'zzz',
    })
  })

  it('내 id가 크면 offer를 만들지 않고 상대 offer를 기다린다', async () => {
    const { mesh, sent } = createMesh('zzz')

    mesh.syncPeers(['zzz', 'aaa'])
    await vi.waitFor(() => expect(mesh.knownPeerIds()).toEqual(['aaa']))
    expect(sent).toEqual([])
  })

  it('명단에서 빠진 상대의 연결은 닫는다', async () => {
    const { mesh } = createMesh('aaa')

    mesh.syncPeers(['aaa', 'bbb'])
    await vi.waitFor(() => expect(mesh.knownPeerIds()).toEqual(['bbb']))

    mesh.syncPeers(['aaa'])
    expect(mesh.knownPeerIds()).toEqual([])
    expect(connections[0]?.close).toHaveBeenCalled()
  })

  it('offer를 받으면 answer를 돌려준다', async () => {
    const { mesh, sent } = createMesh('zzz')

    await mesh.accept('aaa', {
      description: { sdp: 'their-offer', type: 'offer' },
      kind: 'description',
    })

    expect(sent).toEqual([
      {
        data: { description: { sdp: 'answer-sdp', type: 'answer' }, kind: 'description' },
        to: 'aaa',
      },
    ])
  })

  it('remote description 전에 온 ICE 후보를 버리지 않고 나중에 넣는다', async () => {
    const { mesh } = createMesh('zzz')
    const candidate = { candidate: 'candidate:1 udp', sdpMid: '0' }

    await mesh.accept('aaa', { candidate, kind: 'candidate' })
    const connection = connections[0]
    expect(connection?.addIceCandidate).not.toHaveBeenCalled()

    await mesh.accept('aaa', {
      description: { sdp: 'their-offer', type: 'offer' },
      kind: 'description',
    })

    expect(connection?.addIceCandidate).toHaveBeenCalledWith(candidate)
  })

  it('peerIds는 connected인 상대만 센다 — 협상 중은 빼야 한다', async () => {
    const { mesh } = createMesh('aaa')

    mesh.syncPeers(['aaa', 'bbb'])
    await vi.waitFor(() => expect(mesh.knownPeerIds()).toEqual(['bbb']))

    expect(mesh.peerIds()).toEqual([])

    const connection = connections[0]
    if (!connection) throw new Error('연결이 만들어지지 않았다')
    connection.connectionState = 'connected'
    expect(mesh.peerIds()).toEqual(['bbb'])
  })

  it('failed면 명단을 기다리지 않고 다시 협상한다', async () => {
    vi.useFakeTimers()
    try {
      const { mesh, sent } = createMesh('aaa')
      mesh.syncPeers(['aaa', 'bbb'])
      await vi.waitFor(() => expect(sent).toHaveLength(1))

      const dead = connections[0]
      if (!dead) throw new Error('연결이 만들어지지 않았다')
      fireStateChange(dead, 'failed')

      expect(mesh.knownPeerIds()).toEqual([])
      expect(dead.close).toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5000)

      expect(mesh.knownPeerIds()).toEqual(['bbb'])
      expect(connections).toHaveLength(2)
      expect(sent).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('통화를 끄면 재협상 예약도 함께 사라진다', async () => {
    vi.useFakeTimers()
    try {
      const { mesh } = createMesh('aaa')
      mesh.syncPeers(['aaa', 'bbb'])
      const dead = connections[0]
      if (!dead) throw new Error('연결이 만들어지지 않았다')

      fireStateChange(dead, 'failed')
      mesh.close()
      await vi.advanceTimersByTimeAsync(5000)

      expect(mesh.knownPeerIds()).toEqual([])
      expect(connections).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('close는 모든 연결을 닫는다', async () => {
    const { mesh } = createMesh('aaa')
    mesh.syncPeers(['aaa', 'bbb', 'ccc'])
    await vi.waitFor(() => expect(mesh.knownPeerIds()).toHaveLength(2))

    mesh.close()

    expect(mesh.knownPeerIds()).toEqual([])
    for (const connection of connections) expect(connection.close).toHaveBeenCalled()
  })
})
