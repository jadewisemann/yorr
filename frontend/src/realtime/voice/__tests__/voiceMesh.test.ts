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
  connectionState: string
}

const connections: FakeConnection[] = []

function stubWebRtc() {
  connections.length = 0
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      remoteDescription: object | null = null
      // 실제 RTCPeerConnection의 초기값. 협상이 끝나면 브라우저가 'connected'로 바꾼다.
      connectionState = 'new'
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
  // 진짜 <audio> 엘리먼트를 쓴다. VoiceMesh가 document.body에 붙이므로(iOS Safari 대응)
  // 손으로 만든 객체를 주면 append에서 던진다. jsdom의 play()는 미구현이라 그것만 바꿔 끼운다.
  vi.stubGlobal('Audio', function FakeAudio() {
    const element = document.createElement('audio')
    element.play = vi.fn(async () => undefined)
    return element
  })
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

  // peerIds가 맵 크기를 그대로 돌려주던 시절, 화면 배지가 협상도 안 끝난 피어를
  // "연결됨"으로 세어 실제로는 소리가 안 오가는데 "1명 연결됨"이라고 표시했다.
  it('peerIds는 connected인 상대만 센다 — 협상 중은 빼야 한다', async () => {
    const { mesh } = createMesh('aaa')

    mesh.syncPeers(['aaa', 'bbb'])
    await vi.waitFor(() => expect(mesh.knownPeerIds()).toEqual(['bbb']))

    // 아직 붙지 않았다 → 화면에는 0명이어야 한다.
    expect(mesh.peerIds()).toEqual([])

    const connection = connections[0]
    if (!connection) throw new Error('연결이 만들어지지 않았다')
    connection.connectionState = 'connected'
    expect(mesh.peerIds()).toEqual(['bbb'])
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
