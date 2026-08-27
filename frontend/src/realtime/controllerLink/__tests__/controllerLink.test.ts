import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildClientMessage, type ControllerLinkSignal, type PlayerId } from '@/realtime/wsEvents'
import { FakeDataChannel, rtcConnections, stubWebRtc } from '@/test/rtcStubs'
import { ControllerLink, type ControllerLinkRole } from '../controllerLink'
import type { ControllerLinkFrame } from '../relay'

function createLink(role: ControllerLinkRole) {
  const signals: Array<{ to: PlayerId; signal: ControllerLinkSignal }> = []
  const frames: Array<{ from: PlayerId; frame: ControllerLinkFrame }> = []
  const link = new ControllerLink({
    role,
    iceServers: [],
    sendSignal: (to, signal) => signals.push({ signal, to }),
    onFrame: (from, frame) => frames.push({ frame, from }),
    onChanged: () => undefined,
  })
  return { frames, link, signals }
}

const offer: ControllerLinkSignal = {
  kind: 'description',
  description: { sdp: 'remote-offer', type: 'offer' },
}

const shake = buildClientMessage(
  'game.yacht_dice.dice.shake',
  { direction: 'right', roundNumber: 1, strength: 0.5 },
  { roomId: 'ROOM1' },
)

const throwMessage = buildClientMessage(
  'game.yacht_dice.dice.throw',
  { rollCount: 1, roundNumber: 1 },
  { roomId: 'ROOM1' },
)

describe('ControllerLink', () => {
  beforeEach(stubWebRtc)

  it('대시보드가 채널 두 개를 만든 뒤 offer를 보낸다', async () => {
    const { link, signals } = createLink('dashboard')

    link.syncPeers(['phone-1'])
    await vi.waitFor(() => expect(signals).toHaveLength(1))

    // 채널은 offer 전에 만들어져야 SDP에 실린다.
    expect(rtcConnections[0]?.channels.map((channel) => channel.label)).toEqual([
      'yorr.ctrl.pulse',
      'yorr.ctrl.event',
    ])
    expect(signals[0]).toEqual({
      to: 'phone-1',
      signal: { kind: 'description', description: { sdp: 'offer-sdp', type: 'offer' } },
    })
  })

  it('펄스 채널만 unreliable이다', async () => {
    const { link, signals } = createLink('dashboard')

    link.syncPeers(['phone-1'])
    await vi.waitFor(() => expect(signals).toHaveLength(1))

    const [pulse, event] = rtcConnections[0]?.channels ?? []
    expect(pulse?.init).toEqual({ ordered: false, maxRetransmits: 0 })
    expect(event?.init).toEqual({ ordered: false })
  })

  it('컨트롤러는 offer를 만들지 않고 answer만 돌려준다', async () => {
    const { link, signals } = createLink('controller')

    link.syncPeers(['dashboard-1']) // 컨트롤러에서는 무시된다
    expect(rtcConnections).toHaveLength(0)

    await link.accept('dashboard-1', offer)

    expect(signals).toEqual([
      {
        to: 'dashboard-1',
        signal: { kind: 'description', description: { sdp: 'answer-sdp', type: 'answer' } },
      },
    ])
  })

  it('remote description 전에 온 ICE 후보는 큐에 쌓았다가 flush한다', async () => {
    const { link } = createLink('controller')

    await link.accept('dashboard-1', {
      kind: 'candidate',
      candidate: { candidate: 'early' },
    })
    const connection = rtcConnections[0]
    expect(connection?.addIceCandidate).not.toHaveBeenCalled()

    await link.accept('dashboard-1', offer)

    expect(connection?.addIceCandidate).toHaveBeenCalledWith({ candidate: 'early' })
  })

  it('흔들기는 펄스 채널, 던지기는 이벤트 채널로 나간다', async () => {
    const { link, signals } = createLink('dashboard')
    link.syncPeers(['phone-1'])
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    const [pulse, event] = rtcConnections[0]?.channels ?? []
    pulse?.open()
    event?.open()

    expect(link.send(shake)).toBe(true)
    expect(link.send(throwMessage)).toBe(true)

    expect(pulse?.sent.map((raw) => JSON.parse(raw).message.type)).toEqual([
      'game.yacht_dice.dice.shake',
    ])
    expect(event?.sent.map((raw) => JSON.parse(raw).message.type)).toEqual([
      'game.yacht_dice.dice.throw',
    ])
  })

  it('채널이 열리지 않았으면 false를 돌려준다 — 호출부가 WebSocket으로 폴백한다', async () => {
    const { link, signals } = createLink('dashboard')
    link.syncPeers(['phone-1'])
    await vi.waitFor(() => expect(signals).toHaveLength(1))

    expect(link.send(shake)).toBe(false)
    expect(link.openPeerIds()).toEqual([])
  })

  it('닫힌 뒤에는 아무것도 보내지 않는다', async () => {
    const { link, signals } = createLink('dashboard')
    link.syncPeers(['phone-1'])
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    for (const channel of rtcConnections[0]?.channels ?? []) channel.open()

    link.close()

    expect(link.send(shake)).toBe(false)
    expect(link.openPeerIds()).toEqual([])
  })

  it('받은 릴레이 프레임을 그대로 올려 보낸다', async () => {
    const { frames, link } = createLink('controller')
    await link.accept('dashboard-1', offer)
    const channel = new FakeDataChannel('yorr.ctrl.pulse')
    rtcConnections[0]?.fire('datachannel', { channel })

    channel.receive({ kind: 'relay', message: shake })

    expect(frames).toEqual([{ from: 'dashboard-1', frame: { kind: 'relay', message: shake } }])
  })

  it('ping은 그 자리에서 pong으로 되돌려 준다', async () => {
    const { link } = createLink('dashboard')
    link.syncPeers(['phone-1'])
    await vi.waitFor(() => expect(rtcConnections).toHaveLength(1))
    const event = rtcConnections[0]?.channels[1]
    event?.open()

    event?.receive({ kind: 'ping', sentAt: 1_000 })

    expect(event?.sent.map((raw) => JSON.parse(raw))).toEqual([{ kind: 'pong', sentAt: 1_000 }])
  })

  it('컨트롤러는 failed에서 스스로 재협상하지 않는다', async () => {
    const { link } = createLink('controller')
    await link.accept('dashboard-1', offer)
    const connection = rtcConnections[0]

    if (connection) connection.connectionState = 'failed'
    connection?.fire('connectionstatechange', {})
    await vi.waitFor(() => expect(link.openPeerIds()).toEqual([]))

    // offer를 만드는 쪽은 대시보드뿐이다 — 폰이 새 연결을 만들면 상대 없는 협상이 쌓인다.
    expect(rtcConnections).toHaveLength(1)
  })

  it('대시보드는 failed 피어를 유예 뒤 다시 협상한다', async () => {
    vi.useFakeTimers()
    try {
      const { link } = createLink('dashboard')
      link.syncPeers(['phone-1'])
      await vi.waitFor(() => expect(rtcConnections).toHaveLength(1))
      const connection = rtcConnections[0]

      if (connection) connection.connectionState = 'failed'
      connection?.fire('connectionstatechange', {})
      await vi.advanceTimersByTimeAsync(2_000)

      expect(rtcConnections).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
