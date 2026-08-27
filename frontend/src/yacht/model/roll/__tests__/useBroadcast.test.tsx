import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { dashboardSession, MOCK_ROOM_ID, participantSession, serverMessage } from '@/mocks/fixtures'
import {
  ControllerLinkProvider,
  useControllerLink,
} from '@/realtime/controllerLink/ControllerLinkContext'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { ControllerLinkSignal } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { FakeDataChannel, rtcConnections, stubWebRtc } from '@/test/rtcStubs'
import { useRollBroadcast } from '../useBroadcast'

const offer: ControllerLinkSignal = {
  kind: 'description',
  description: { sdp: 'remote-offer', type: 'offer' },
}

function renderBroadcast() {
  useAppStore.getState().setRoomSession(participantSession)
  const client = new FakeRealtimeClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeClientProvider client={client}>
      <ControllerLinkProvider linkRole="controller">{children}</ControllerLinkProvider>
    </RealtimeClientProvider>
  )
  const view = renderHook(
    () => ({ broadcast: useRollBroadcast(MOCK_ROOM_ID, 1), link: useControllerLink() }),
    { wrapper },
  )

  const sentTypes = () => client.sentMessages.map((message) => message.type)

  /** 대시보드가 건 협상을 받아 채널 두 개를 열어 준다 — 실제 연결 순서와 같다. */
  async function openLink() {
    client.emitMessage(serverMessage('ctrl.signaled', { from: dashboardSession.you, data: offer }))
    await waitFor(() => expect(rtcConnections).toHaveLength(1))
    const pulse = new FakeDataChannel('yorr.ctrl.pulse')
    const event = new FakeDataChannel('yorr.ctrl.event')
    rtcConnections[0]?.fire('datachannel', { channel: pulse })
    rtcConnections[0]?.fire('datachannel', { channel: event })
    pulse.open()
    event.open()
    return { event, pulse }
  }

  return { ...view, client, openLink, sentTypes }
}

describe('useRollBroadcast', () => {
  beforeEach(() => {
    stubWebRtc()
    useAppStore.getState().reset()
  })

  it('링크가 없으면 연출 릴레이가 WebSocket으로 간다', async () => {
    const view = renderBroadcast()
    await waitFor(() => expect(rtcConnections).toHaveLength(0))

    view.result.current.broadcast.publishShake('left', 0.4)
    view.result.current.broadcast.publishThrow(1)

    expect(view.sentTypes()).toEqual(['game.yacht_dice.dice.shake', 'game.yacht_dice.dice.throw'])
  })

  it('링크가 열리면 서버를 거치지 않고 직접 보낸다', async () => {
    const view = renderBroadcast()
    const { event, pulse } = await view.openLink()

    view.result.current.broadcast.publishShake('left', 0.4)
    view.result.current.broadcast.publishThrow(2)

    // 두 경로로 동시에 보내지 않는다 — 대시보드가 같은 그림을 두 번 그린다.
    expect(view.sentTypes()).not.toContain('game.yacht_dice.dice.shake')
    expect(view.sentTypes()).not.toContain('game.yacht_dice.dice.throw')
    expect(pulse.frames()).toMatchObject([{ kind: 'relay' }])
    expect(
      event.frames().filter((frame) => (frame as { kind: string }).kind === 'relay'),
    ).toHaveLength(1)
  })

  it('킵은 링크가 열려 있어도 서버로 간다 — 서버가 라운드 상태에 저장한다', async () => {
    const view = renderBroadcast()
    await view.openLink()

    view.result.current.broadcast.publishHeld([true, false, false, false, false])

    expect(view.sentTypes()).toContain('game.yacht_dice.dice.hold')
  })

  it('채널이 닫히면 다시 WebSocket으로 떨어진다', async () => {
    const view = renderBroadcast()
    const { pulse } = await view.openLink()
    pulse.close()

    view.result.current.broadcast.publishShake('right', 0.6)

    expect(view.sentTypes()).toContain('game.yacht_dice.dice.shake')
  })
})
