import type { InboundEnvelope } from '../ws/envelope.js'
import { envelope } from '../ws/envelope.js'
import type { WsErrorCode } from '../ws/protocol.js'
import { type ClientSocket, isOpen } from '../ws/socket.js'
import type { GameModule } from './module.js'

/**
 * 게임 모듈의 수명주기 훅 대부분을 자기 서비스에 그대로 넘기는 구현들이 있다.
 * 결투·다빈치·탁구가 그렇다 — 훅 본문이 `await this.games.<같은 이름>(roomCode)`
 * 한 줄이라, 모듈마다 7개씩 같은 글자를 복창하고 있었다.
 *
 * 이 베이스는 그 위임만 담는다. 게임별로 다른 것은 세 가지뿐이다:
 *
 * - `start`: 인자 타입이 게임마다 다르다(`GameStartResult`·`PingPongGameStart` …).
 * - `reconnect`: 결투·탁구는 `(roomCode)`, 다빈치는 `(roomCode, playerId)`다.
 * - `handles`·`handle`: 게임 고유 표면이다.
 *
 * 그래서 이 클래스는 `abstract`이고 `GameModule` 전체를 만족시키지 못한다 —
 * 서브클래스가 나머지를 채운다. `GameModule`을 `implements`하지 않는 이유가
 * 그것이다(채우지 않은 채 통과하면 계약이 느슨해진다).
 *
 * 서비스 타입을 제네릭으로 받는 이유: 서브클래스가 자기 게임 서비스의 고유
 * 메서드(`draw`·`guess` …)를 `this.games`에서 그대로 써야 한다. 베이스가
 * `DelegatingGameService`로 좁히면 그 접근이 사라진다.
 */
export interface DelegatingGameService {
  reset(roomCode: string): Promise<void>
  pause(roomCode: string): Promise<void>
  resume(roomCode: string): Promise<void>
  rehydrate(roomCode: string): Promise<void>
  removePlayer(roomCode: string, playerId: string): Promise<void>
  close(roomCode: string): Promise<void>
  hasState(roomCode: string): Promise<boolean>
}

export abstract class DelegatingGameModule<S extends DelegatingGameService = DelegatingGameService>
  implements Partial<GameModule>
{
  abstract readonly code: string

  constructor(protected readonly games: S) {}

  async reset(roomCode: string): Promise<void> {
    await this.games.reset(roomCode)
  }

  async pause(roomCode: string): Promise<void> {
    await this.games.pause(roomCode)
  }

  async resume(roomCode: string): Promise<void> {
    await this.games.resume(roomCode)
  }

  async rehydrate(roomCode: string): Promise<void> {
    await this.games.rehydrate(roomCode)
  }

  async removePlayer(roomCode: string, playerId: string): Promise<void> {
    await this.games.removePlayer(roomCode, playerId)
  }

  async close(roomCode: string): Promise<void> {
    await this.games.close(roomCode)
  }

  async hasState(roomCode: string): Promise<boolean> {
    return this.games.hasState(roomCode)
  }
}

/**
 * `error` 봉투는 roomId·msgId를 싣지 않는다 — 요청 payload의 `refMsgId`로 짝을 맞춘다.
 *
 * 모듈이 **자기 응답을 직접 보내는 것**이 계약이다(`registry.dispatch`는 예외를 잡지
 * 않는다). 전송 실패는 삼킨다 — 죽은 소켓 하나 때문에 이미 끝난 상태 전이의 결과를
 * 잃지 않는다.
 */
export const sendModuleError = (
  socket: ClientSocket,
  code: WsErrorCode,
  message: string,
  request: InboundEnvelope,
): void => {
  if (!isOpen(socket)) return
  try {
    socket.send(JSON.stringify(envelope('error', { code, message, refMsgId: request.msgId })))
  } catch {
    // 게이트웨이의 close 경로가 정리한다.
  }
}
