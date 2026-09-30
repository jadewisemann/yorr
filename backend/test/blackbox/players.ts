import { type Entrant, enterRoom, nicknameFor } from './http.js'
import type { Target } from './target.js'
import { type Envelope, WsClient } from './ws.js'

/** 방에 앉은 사람 하나 — REST 세션과 `room.join`까지 끝난 소켓. */
export interface Seat {
  readonly entrant: Entrant
  readonly ws: WsClient
}

const joinedPlayerId = (message: Envelope): string | undefined =>
  (message.payload as { player?: { playerId?: string } }).player?.playerId

/** 소켓을 열고 `room.join`까지 끝낸다. 재접속이면 `room.joined` 대신 `sys.reconnected`가 온다. */
export const takeSeat = async (target: Target, entrant: Entrant): Promise<Seat> => {
  const ws = await WsClient.open(target.wsUrl, entrant.nickname)
  await ws.next('sys.connected')
  ws.send('room.join', { roomId: entrant.roomId, sessionToken: entrant.token })
  await ws.next(['room.joined', 'sys.reconnected'])
  return { entrant, ws }
}

/**
 * 호스트와 `count - 1`명이 한 방에 소켓까지 붙은 상태. 먼저 앉은 사람들이 받는 입장 방송은
 * 여기서 소비해 둔다 — 호출한 쪽의 큐는 "게임 시작 직전"에서 출발한다.
 */
export const seatedRoom = async (
  target: Target,
  count: number,
  gameCode = 'YACHT_DICE',
): Promise<Seat[]> => {
  const host = await enterRoom(target, nicknameFor('host'), undefined, gameCode)
  const seats = [await takeSeat(target, host)]
  for (let index = 1; index < count; index += 1) {
    const guest = await enterRoom(target, nicknameFor(`p${index}`), host.roomId, gameCode)
    const seat = await takeSeat(target, guest)
    for (const earlier of seats) {
      await earlier.ws.next('room.player_joined', (message) => joinedPlayerId(message) === guest.id)
    }
    seats.push(seat)
  }
  return seats
}

export const leaveAll = async (seats: readonly Seat[]): Promise<void> => {
  await Promise.all(seats.map((seat) => seat.ws.close()))
}
