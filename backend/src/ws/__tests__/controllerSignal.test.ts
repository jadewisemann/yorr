import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { FakeSocket, frame, useWsHandler } from './wsHarness.js'

/**
 * 컨트롤러 링크 시그널링 — 삭제된 `voice.test.ts`의 릴레이 케이스를 옮긴 것이다.
 * 서버가 검증해야 하는 것은 **누구에게 가는가와 from을 누가 채우는가**뿐이다
 * (계약 문서: docs/design/controller-signal.md).
 */

describeRedis('컨트롤러 링크 시그널링(GameSocketHandler)', () => {
  const ws = useWsHandler(useRedis())

  const signalFrame = (payload: unknown, msgId?: string): string =>
    frame('ctrl.signal', payload, { roomId: 'room-a', ...(msgId ? { msgId } : {}) })

  it('지목된 상대에게만 가고 from은 서버가 채운다', async () => {
    const { roomCode, host, hostSocket, guest, guestSocket } = await ws.enterPair('컨트롤러')
    guestSocket.clear()

    await ws.handler.message(
      hostSocket,
      signalFrame(
        {
          to: guest.userId,
          // from을 클라이언트가 우겨 넣어도 서버가 무시해야 한다(사칭 방지).
          from: 'player-임의조작',
          data: { kind: 'ctrl.candidate', candidate: { candidate: 'host udp' } },
        },
        'ctrl-a',
      ),
    )

    expect(guestSocket.only()).toMatchObject({
      type: 'ctrl.signaled',
      roomId: roomCode,
      payload: {
        from: host.userId,
        data: { kind: 'ctrl.candidate', candidate: { candidate: 'host udp' } },
      },
    })
    expect(guestSocket.sent[0]).not.toContain('player-임의조작')
    // 두 피어 사이의 협상이라 방 전체로 나가면 안 된다.
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('서버는 data를 열지 않는다 — 모르는 모양도 그대로 전달한다', async () => {
    const { hostSocket, guest, guestSocket } = await ws.enterPair('컨트롤러')
    guestSocket.clear()

    // 브라우저가 규격을 늘리거나 클라이언트가 갈래를 추가해도 서버는 안 바뀌어야 한다.
    await ws.handler.message(
      hostSocket,
      signalFrame({ to: guest.userId, data: { kind: '미래의갈래' } }),
    )

    expect(guestSocket.only()).toMatchObject({
      type: 'ctrl.signaled',
      payload: { data: { kind: '미래의갈래' } },
    })
  })

  it('부재 상대에게 보낸 시그널은 오류 없이 버린다', async () => {
    const { roomCode, host } = await ws.openRoom()
    const hostSocket = await ws.enter(roomCode, host)

    await ws.handler.message(hostSocket, signalFrame({ to: 'player-이미나감', data: {} }, 'orphan'))

    // 협상 중 이탈은 정상 상황이다 — 오류로 만들면 나갈 때마다 남은 쪽에 잡음이 쌓인다.
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('다른 방 사람에게는 시그널이 가지 않는다', async () => {
    const { roomCode, host } = await ws.openRoom()
    const hostSocket = await ws.enter(roomCode, host)
    const other = await ws.openRoom()
    const otherSocket = await ws.enter(other.roomCode, other.host)

    await ws.handler.message(hostSocket, signalFrame({ to: other.host.userId, data: {} }))

    expect(otherSocket.sent).toHaveLength(0)
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('to가 비었거나 data가 없으면 INVALID_MESSAGE다', async () => {
    const { roomCode, host } = await ws.openRoom()
    const socket = await ws.enter(roomCode, host)

    await ws.handler.message(socket, signalFrame({ to: '  ', data: {} }, 'blank-to'))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'blank-to' },
    })

    socket.clear()
    await ws.handler.message(socket, signalFrame({ to: 'player-b' }, 'no-data'))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'no-data' },
    })
  })

  it('방에 들어오기 전에 보내면 NOT_IN_ROOM이다', async () => {
    const socket = new FakeSocket()

    await ws.handler.message(socket, signalFrame({ to: 'player-b', data: {} }, 'outside'))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'NOT_IN_ROOM', refMsgId: 'outside' },
    })
  })
})
