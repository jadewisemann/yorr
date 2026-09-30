import { afterEach, expect, it } from 'vitest'
import { startGame } from './http.js'
import { leaveAll, type Seat, seatedRoom } from './players.js'
import { describeTarget, escapedHandlerErrors, useTarget } from './target.js'
import { WsClient } from './ws.js'
import { type RoundStart, yacht } from './yachtDriver.js'

/**
 * 재접속은 스냅샷 동기화다(DESIGN.md 원칙 4): `room.join`을 다시 보내면 `sys.reconnected`의
 * 스냅샷이 새 기준점이 된다. 네트워크가 끊긴 것처럼(close 프레임 없이) 끊고 되돌아온다.
 */
describeTarget('재접속 (블랙박스)', () => {
  const target = useTarget()
  let seats: Seat[] = []

  afterEach(async () => {
    await leaveAll(seats)
    seats = []
    expect(escapedHandlerErrors(target())).toEqual([])
  })

  const startedGame = async (): Promise<{ host: Seat; guest: Seat; turn: RoundStart }> => {
    seats = await seatedRoom(target(), 2)
    const [host, guest] = seats as [Seat, Seat]
    await startGame(target(), host.entrant)
    const [turn] = await Promise.all([
      host.ws.next(yacht('round.start')),
      guest.ws.next(yacht('round.start')),
    ])
    return { host, guest, turn: turn.payload as RoundStart }
  }

  it('굴린 뒤 끊겼다 돌아오면 같은 턴·같은 주사위·같은 마감으로 이어서 굴린다', async () => {
    const { host, guest, turn } = await startedGame()
    const rollId = host.ws.send(
      yacht('dice.roll'),
      { roundNumber: 1, rollCount: 1, held: [false, false, false, false, false] },
      { roomId: host.entrant.roomId },
    )
    const rolled = await host.ws.next(yacht('dice.broadcast'), (m) => m.msgId === rollId)
    const rearmed = (await host.ws.next(yacht('round.start'))).payload as RoundStart
    const dice = (rolled.payload as { dice: number[] }).dice

    host.ws.terminate()
    expect((await guest.ws.next('presence.update')).payload).toEqual({
      playerId: host.entrant.id,
      status: 'offline',
    })

    const back = await WsClient.open(target().wsUrl, `${host.entrant.nickname}-back`)
    seats[0] = { entrant: host.entrant, ws: back }
    const joinId = back.send('room.join', {
      roomId: host.entrant.roomId,
      sessionToken: host.entrant.token,
    })
    const reconnected = await back.next('sys.reconnected', (m) => m.msgId === joinId)
    expect(reconnected.payload).toMatchObject({
      snapshot: {
        roomId: host.entrant.roomId,
        phase: 'playing',
        game: {
          roundNumber: turn.roundNumber,
          activePlayerId: host.entrant.id,
          rollCount: 1,
          dice,
          roundDeadline: rearmed.deadline,
          turnOrder: turn.turnOrder,
        },
      },
    })
    expect((await guest.ws.next('presence.update')).payload).toEqual({
      playerId: host.entrant.id,
      status: 'online',
    })

    // 스냅샷이 기준점이다 — 끊기기 전 상태에서 곧바로 두 번째 굴림을 이어 간다.
    const secondId = back.send(
      yacht('dice.roll'),
      { roundNumber: 1, rollCount: 2, held: [true, true, false, false, false] },
      { roomId: host.entrant.roomId },
    )
    const second = await guest.ws.next(yacht('dice.broadcast'), (m) => m.msgId === secondId)
    expect((second.payload as { dice: number[] }).dice.slice(0, 2)).toEqual(dice.slice(0, 2))
  })

  it('같은 세션으로 두 번째 소켓이 붙으면 첫 소켓은 1008로 교체된다', async () => {
    const { host } = await startedGame()

    const second = await WsClient.open(target().wsUrl, `${host.entrant.nickname}-2`)
    const replaced = host.ws.closed
    second.send('room.join', { roomId: host.entrant.roomId, sessionToken: host.entrant.token })

    expect(await second.next('sys.reconnected')).toBeDefined()
    expect((await host.ws.next('sys.disconnect')).payload).toEqual({
      reason: 'replaced_by_new_session',
    })
    expect((await replaced).code).toBe(1008)
    seats[0] = { entrant: host.entrant, ws: second }
  })
})
