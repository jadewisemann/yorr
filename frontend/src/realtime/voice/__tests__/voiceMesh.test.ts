import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerId, VoiceSignalData } from '../../wsEvents'
import { VoiceMesh } from '../voiceMesh'

/**
 * jsdom에는 WebRTC가 없다. 실제 협상은 브라우저(E2E)에서만 확인할 수 있으므로 여기서는
 * VoiceMesh가 **직접 정하는 두 규칙**만 본다 — 둘 다 틀리면 통화가 조용히 안 붙는다.
 *   1. offer는 playerId가 작은 쪽만 만든다(glare 방지)
 *   2. remote description 전에 온 ICE 후보는 큐에 쌓았다가 나중에 넣는다
 */

interface FakeConnection {
  addIceCandidate: ReturnType<typeof vi.fn>
  setRemoteDescription: ReturnType<typeof vi.fn>
  createOffer: ReturnType<typeof vi.fn>
  createAnswer: ReturnType<typeof vi.fn>
  setLocalDescription: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  remoteDescription: object | null
}

const connections: FakeConnection[] = []

function stubWebRtc() {
  connections.length = 0
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      remoteDescription: object | null = null
      addIceCandidate = vi.fn(async () => undefined)
      createOffer = vi.fn(async () => ({ sdp: 'offer-sdp', type: 'offer' as const }))
      createAnswer = vi.fn(async () => ({ sdp: 'answer-sdp', type: 'answer' as const }))
      setLocalDescription = vi.fn(async () => undefined)
      // 실제 구현처럼 remoteDescription이 채워지는 것까지 흉내낸다 — 큐 비우기 조건이다.
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
  vi.stubGlobal(
    'Audio',
    class {
      autoplay = false
      srcObject: unknown = null
      play = vi.fn(async () => undefined)
    },
  )
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
    // 연결은 만들되 시그널은 보내지 않는다 — 양쪽이 offer하면 협상이 깨진다.
    await vi.waitFor(() => expect(mesh.peerIds()).toEqual(['aaa']))
    expect(sent).toEqual([])
  })

  it('명단에서 빠진 상대의 연결은 닫는다', async () => {
    const { mesh } = createMesh('aaa')

    mesh.syncPeers(['aaa', 'bbb'])
    await vi.waitFor(() => expect(mesh.peerIds()).toEqual(['bbb']))

    mesh.syncPeers(['aaa'])
    expect(mesh.peerIds()).toEqual([])
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

    // description보다 후보가 먼저 도착하는 순서 — 메시지가 별개라 순서 보장이 없다.
    await mesh.accept('aaa', { candidate, kind: 'candidate' })
    const connection = connections[0]
    expect(connection?.addIceCandidate).not.toHaveBeenCalled()

    await mesh.accept('aaa', {
      description: { sdp: 'their-offer', type: 'offer' },
      kind: 'description',
    })

    // 큐가 없으면 이 후보가 사라져 연결이 간헐적으로 실패한다.
    expect(connection?.addIceCandidate).toHaveBeenCalledWith(candidate)
  })

  it('close는 모든 연결을 닫는다', async () => {
    const { mesh } = createMesh('aaa')
    mesh.syncPeers(['aaa', 'bbb', 'ccc'])
    await vi.waitFor(() => expect(mesh.peerIds()).toHaveLength(2))

    mesh.close()

    expect(mesh.peerIds()).toEqual([])
    for (const connection of connections) expect(connection.close).toHaveBeenCalled()
  })
})
