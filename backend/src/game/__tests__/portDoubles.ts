import { expect } from 'vitest'
import type { RoomSessionRegistry } from '../../ws/registry.js'
import { type ClientSocket, SOCKET_OPEN } from '../../ws/socket.js'

/** 보낸 것을 그대로 쌓아 두는 소켓. 포트 호환 검사가 전송을 확인하는 유일한 창이다. */
export interface FakeSocket extends ClientSocket {
  readonly sent: string[]
}

export const fakeSocket = (): FakeSocket => {
  const sent: string[] = []
  return {
    readyState: SOCKET_OPEN,
    sent,
    send: (data: string) => sent.push(data),
    close: () => {},
  }
}

/** 소켓이 마지막으로 내보낸 봉투. 쌓인 문자열을 되돌려 읽는다. */
export const lastFrame = (socket: FakeSocket): { type: string; payload: Record<string, string> } =>
  JSON.parse(socket.sent.at(-1) ?? 'null')

/**
 * 마감 예약 포트가 **version을 키로 써도** 예약과 발화가 성립하는지 본다. 게임마다
 * 포트 타입이 다르므로 대입은 호출부에서 하고(그것이 이 검사의 요지다), 여기서는
 * 예약기가 실제로 깨어나는지만 확인한다.
 */
export async function expectDeadlineFires(port: {
  schedule(
    roomId: string,
    version: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void
  cancelRoom(roomId: string): unknown
}): Promise<void> {
  const fired: number[] = []

  port.schedule('room-a', 7, Date.now(), () => {
    fired.push(7)
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(fired).toEqual([7])
  port.cancelRoom('room-a')
}

/**
 * `RoomSessionRegistry`가 게임별 presence·lookup 포트를 **동시에** 만족하는지 본다.
 *
 * 포트 타입은 게임마다 다르므로 대입은 호출부에서 한다 — 그 대입이 곧 계약
 * 검사의 요지다. 여기서는 두 포트를 통해 본 상태가 실제 레지스트리와 어긋나지
 * 않는지만 확인한다.
 */
export function expectRegistryServesSeats(params: {
  readonly registry: RoomSessionRegistry
  readonly markPlaying: (roomId: string) => void
  readonly playerIdOf: (socket: ClientSocket) => string | null
}): void {
  const { markPlaying, playerIdOf, registry } = params
  const socket = fakeSocket()
  registry.join('room-a', socket, 'player-1', '요르')

  markPlaying('room-a')

  expect(registry.phaseOf('room-a')).toBe('playing')
  expect(playerIdOf(socket)).toBe('player-1')
  expect(playerIdOf(fakeSocket())).toBeNull()
}
