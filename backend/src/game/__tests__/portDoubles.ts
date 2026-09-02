import { expect } from 'vitest'
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
