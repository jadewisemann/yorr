import { afterEach, expect, it } from 'vitest'
import { authHeaders, enterRoom, nicknameFor, request } from './http.js'
import { leaveAll, type Seat, seatedRoom, takeSeat } from './players.js'
import { describeTarget, escapedHandlerErrors, useTarget } from './target.js'

/** 로비 — 방 만들기·입장 방송·채팅·준비·나가기. 전부 진짜 HTTP와 진짜 소켓으로 간다. */
describeTarget('로비 (블랙박스)', () => {
  const target = useTarget()
  let seats: Seat[] = []

  afterEach(async () => {
    await leaveAll(seats)
    seats = []
    expect(escapedHandlerErrors(target())).toEqual([])
  })

  it('REST로 만든 방에 join하면 스냅샷을 받고, 다음 사람의 입장이 방송된다', async () => {
    const host = await enterRoom(target(), nicknameFor('host'))
    const hostSeat = await takeSeat(target(), host)
    seats.push(hostSeat)
    const joined = hostSeat.ws.all('room.joined')[0]
    expect(joined?.payload).toMatchObject({
      you: host.id,
      snapshot: {
        roomId: host.roomId,
        gameCode: 'YACHT_DICE',
        phase: 'waiting',
        hostId: host.id,
        capacity: 6,
        players: [{ playerId: host.id, nickname: host.nickname, status: 'online' }],
      },
    })

    const guest = await enterRoom(target(), nicknameFor('guest'), host.roomId)
    seats.push(await takeSeat(target(), guest))

    const announced = await hostSeat.ws.next('room.player_joined')
    expect(announced.payload).toMatchObject({
      player: { playerId: guest.id, nickname: guest.nickname, status: 'online' },
    })
  })

  it('채팅은 보낸 사람을 서버가 채워 방 전원에게 같은 줄로 방송한다', async () => {
    seats = await seatedRoom(target(), 2)
    const [host, guest] = seats as [Seat, Seat]

    guest.ws.send('chat.send', {
      text: '  먼저 굴려요  ',
      playerId: host.entrant.id,
      nickname: '사칭',
    })

    const [seenByHost, seenByGuest] = await Promise.all([
      host.ws.next('chat.message'),
      guest.ws.next('chat.message'),
    ])
    expect(seenByHost.payload).toMatchObject({
      playerId: guest.entrant.id,
      nickname: guest.entrant.nickname,
      text: '먼저 굴려요',
    })
    expect(seenByGuest.payload).toEqual(seenByHost.payload)
  })

  it('준비 상태가 방 전원에게 방송된다', async () => {
    seats = await seatedRoom(target(), 2)
    const [host, guest] = seats as [Seat, Seat]

    guest.ws.send('room.ready', { ready: true })

    expect((await host.ws.next('room.ready_changed')).payload).toMatchObject({
      playerId: guest.entrant.id,
      ready: true,
    })
  })

  /**
   * 프론트의 나가기 순서 그대로다(`useLeaveSession`): REST로 좌석을 빼고 소켓을 닫는다.
   * 대기실에서는 REST 자체가 방송하지 않는다 — 남은 사람에게 알리는 것은 소켓 종료다.
   */
  it('REST로 나가고 소켓을 닫으면 남은 사람에게 room.player_left가 간다', async () => {
    seats = await seatedRoom(target(), 2)
    const [host, guest] = seats as [Seat, Seat]

    const left = await request(
      target(),
      'DELETE',
      `/api/v1/rooms/${guest.entrant.roomId}/players/me`,
      { headers: authHeaders(guest.entrant) },
    )
    expect(left.status).toBe(204)
    await host.ws.expectSilence('room.player_left', 200)
    await guest.ws.close()

    expect((await host.ws.next('room.player_left')).payload).toEqual({
      playerId: guest.entrant.id,
    })
  })
})
