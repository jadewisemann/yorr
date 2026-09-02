import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  creatorPlayer,
  dashboardSession,
  MOCK_ROOM_ID,
  participantPlayer,
  participantSession,
  serverMessage,
  waitingRoomSnapshot,
} from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import {
  buildClientMessage,
  type ClientMessage,
  type ControllerLinkSignal,
  type ServerMessage,
} from '@/realtime/wsEvents'
import type { RoomSession } from '@/room/api/roomApi'
import { useAppStore } from '@/store'
import { FakeDataChannel, rtcConnections, stubWebRtc } from '@/test/rtcStubs'
import {
  type ControllerLinkChannel,
  ControllerLinkProvider,
  useControllerLink,
} from '../ControllerLinkContext'
import type { ControllerLinkRole } from '../controllerLink'

const shake = buildClientMessage(
  'game.yacht_dice.dice.shake',
  { direction: 'left', roundNumber: 1, strength: 0.4 },
  { roomId: MOCK_ROOM_ID },
)

const offer: ControllerLinkSignal = {
  kind: 'description',
  description: { sdp: 'remote-offer', type: 'offer' },
}

function Probe({ onChannel }: { onChannel: (channel: ControllerLinkChannel) => void }) {
  onChannel(useControllerLink())
  return null
}

function mountLink(role: ControllerLinkRole | null, session: RoomSession = participantSession) {
  useAppStore.getState().setRoomSession(session)
  useAppStore.getState().replaceRoomSnapshot(waitingRoomSnapshot)

  const client = new FakeRealtimeClient()
  const received: ServerMessage[] = []
  client.onMessage((message) => received.push(message))
  let channel: ControllerLinkChannel = { status: 'off', rttMs: () => null, trySend: () => false }

  render(
    <RealtimeClientProvider client={client}>
      <ControllerLinkProvider linkRole={role}>
        <Probe
          onChannel={(next) => {
            channel = next
          }}
        />
      </ControllerLinkProvider>
    </RealtimeClientProvider>,
  )

  const sentSignals = () =>
    (client.sentMessages as ClientMessage[]).filter((message) => message.type === 'ctrl.signal')

  return { client, received, sentSignals, channel: () => channel }
}

/** 대시보드가 건 협상까지 받아 RTC 연결 하나를 세운 컨트롤러. */
async function connectedController() {
  const link = mountLink('controller')
  await waitFor(() => expect(link.channel().status).toBe('connecting'))
  link.client.emitMessage(
    serverMessage('ctrl.signaled', { from: dashboardSession.you, data: offer }),
  )
  await waitFor(() => expect(rtcConnections).toHaveLength(1))
  return link
}

/** 대시보드 쪽에서 데이터 채널을 연다. */
function attachChannel(label: string) {
  const channel = new FakeDataChannel(label)
  rtcConnections[0]?.fire('datachannel', { channel })
  return channel
}

describe('ControllerLinkProvider', () => {
  beforeEach(() => {
    stubWebRtc()
    useAppStore.getState().reset()
  })

  it('역할이 없으면 링크를 만들지 않는다 — 파티 방이 아니면 직결할 상대가 없다', async () => {
    const link = mountLink(null)

    await waitFor(() => expect(link.channel().status).toBe('off'))
    expect(rtcConnections).toHaveLength(0)
    // 호출부는 false를 보고 WebSocket으로 폴백한다.
    expect(link.channel().trySend(shake)).toBe(false)
  })

  it('대시보드는 스냅샷의 사람 참가자마다 협상을 건다', async () => {
    const link = mountLink('dashboard', dashboardSession)

    await waitFor(() => expect(link.sentSignals()).toHaveLength(2))
    expect(link.sentSignals().map((message) => (message.payload as { to: string }).to)).toEqual([
      creatorPlayer.playerId,
      participantPlayer.playerId,
    ])
  })

  it('컨트롤러는 대시보드가 건 협상에 answer로 답한다', async () => {
    const link = mountLink('controller')

    await waitFor(() => expect(rtcConnections).toHaveLength(0))
    link.client.emitMessage(
      serverMessage('ctrl.signaled', { from: dashboardSession.you, data: offer }),
    )

    await waitFor(() => expect(link.sentSignals()).toHaveLength(1))
    expect(link.sentSignals()[0]?.payload).toEqual({
      to: dashboardSession.you,
      data: { kind: 'description', description: { sdp: 'answer-sdp', type: 'answer' } },
    })
  })

  it('링크로 온 릴레이를 서버에서 온 것과 같은 팬아웃에 흘린다', async () => {
    const link = await connectedController()

    const channel = attachChannel('yorr.ctrl.pulse')
    channel.receive({ kind: 'relay', message: shake })

    await waitFor(() =>
      expect(link.received.at(-1)).toMatchObject({
        type: 'game.yacht_dice.dice.shaken',
        roomId: MOCK_ROOM_ID,
        payload: {
          playerId: dashboardSession.you,
          direction: 'left',
          roundNumber: 1,
          strength: 0.4,
        },
      }),
    )
  })

  it('RTT가 갱신돼도 컨텍스트 값의 신원은 그대로다', async () => {
    // 값이 바뀌면 게임 중 2초마다 소비자의 콜백·effect가 재생성된다.
    const link = await connectedController()
    const event = attachChannel('yorr.ctrl.event')
    event.open()
    await waitFor(() => expect(link.channel().status).toBe('open'))
    const before = link.channel()

    event.receive({ kind: 'pong', sentAt: Date.now() - 20 })

    await waitFor(() => expect(link.channel().rttMs()).not.toBeNull())
    expect(link.channel()).toBe(before)
  })

  it('다른 방의 릴레이는 버린다', async () => {
    const link = await connectedController()

    const channel = attachChannel('yorr.ctrl.pulse')
    channel.receive({
      kind: 'relay',
      message: { ...shake, roomId: 'OTHER1' },
    })

    await waitFor(() => expect(rtcConnections).toHaveLength(1))
    expect(link.received.some((message) => message.type === 'game.yacht_dice.dice.shaken')).toBe(
      false,
    )
  })
})
