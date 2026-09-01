/**
 * WS 코어가 소켓에 요구하는 최소 표면. `ws`의 `WebSocket`이 그대로 만족하며,
 * 테스트는 전송 기록만 남기는 가짜 소켓을 넣는다.
 *
 * **객체 참조 자체가 식별자**다 —
 * 별도 id를 발급하면 그 id의 수명과 소켓의 수명을 따로 관리해야 한다.
 */
export interface ClientSocket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
}

/** `WebSocket.OPEN`. 닫히는 중(CLOSING)인 소켓에는 보내지 않는다. */
export const SOCKET_OPEN = 1

export const isOpen = (socket: ClientSocket): boolean => socket.readyState === SOCKET_OPEN
