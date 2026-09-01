import type { PingPongPlayerNumbers, PingPongState } from './pingPongState.js'

/**
 * 탁구 게임 서비스가 **자기 바깥**에 요구하는 것들 — 전부 이 파일의 좁은
 * 포트로만 표현한다. `round/roundPorts.ts`·`completion/completionPorts.ts`와
 * 같은 방식이고 같은 이유다.
 *
 * 스케줄러·브로드캐스터·스냅샷·레지스트리·종료 서비스·Redis·방 검증을 구체
 * 타입으로 잡으면 ① 함께 고쳐지는 계층(ws·room·completion)에 컴파일이 묶이고
 * ② game-modules.md의 "도메인 규칙은 전송 계층을 모른다"를 깬다.
 *
 * 여기 선언한 인터페이스는 실제 클래스가 **구조적으로 이미 만족**하므로 어댑터가
 * 필요 없다 — `__tests__/pingPongPorts.contract.test.ts`가 그 대입 가능성을 고정한다.
 */

/** `ws/envelope.ts`의 `OutboundEnvelope`와 같은 모양. */
export interface PingPongOutboundEnvelope {
  readonly type: string
  readonly ts: number
  readonly payload: unknown
  readonly roomId?: string | undefined
  readonly msgId?: string | undefined
}

/** `RoomBroadcaster`가 그대로 만족한다(팬아웃 1회 직렬화는 그쪽 책임). */
export interface PingPongBroadcaster {
  broadcast(roomId: string, message: PingPongOutboundEnvelope): void
}

/**
 * 탁구가 레지스트리에 옮기는 phase는 **둘뿐**이다: 시작할 때 `playing`,
 * PREPARING 이탈로 매치를 취소할 때 `waiting`. 리터럴로 좁혀 두면
 * `RoomSessionRegistry.markPhase(roomId, WsRoomPhase)`가 안전하게 대입된다
 * (넓은 인자 ← 좁은 인자).
 */
export type PingPongPhaseMark = 'playing' | 'waiting'

/** `RoomSessionRegistry`의 부분집합 — phase 마킹 + 좌석 제거. */
export interface PingPongPresence {
  markPhase(roomId: string, phase: PingPongPhaseMark): void
  /** @returns 실제로 빠진 좌석. 이미 없었으면 null(`room.player_left` 발신 판정에 쓴다). */
  removePlayer(roomId: string, playerId: string): { readonly playerId: string } | null
}

/**
 * 마감 예약 — `InMemoryRoundDeadlineScheduler`가 그대로 만족한다.
 *
 * **두 번째 인자는 라운드 번호가 아니라 상태 `version`이다.** 탁구는 라운드가
 * 없고 모든 변이가 version을 +1 하므로 그것이 자연스러운 세대 키다(version은
 * 1부터라 스케줄러의 `roundNumber >= 1` 검증도 만족한다).
 */
export interface PingPongDeadlineScheduler {
  schedule(
    roomId: string,
    version: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void
  cancelRoom(roomId: string): void
}

/**
 * 실시간 병합 방 스냅샷 — `ws/RealtimeRoomSnapshotService`가 그대로 만족한다.
 *
 * 스냅샷의 **모양은 프레임워크(ws) 소유**이고 탁구는 거기에 `game` 하나를 얹을
 * 뿐이라 타입을 제네릭으로 받는다(2.8 `reconnectPorts.ts`의 `PhasedRoomSnapshot`과
 * 같은 경계). 내용은 해석하지 않는다.
 */
export interface PingPongSnapshotService<S extends object> {
  snapshot(roomId: string): Promise<S>
}

/**
 * 게임 종료 판정(2.7 `GameCompletionService.finishIfComplete`). 탁구는 자체
 * 종료 판정을 갖고 있으므로 **항상 `force=true`** 로 부른다.
 */
export interface PingPongCompletionPort {
  finishIfComplete(roomId: string, force: boolean): Promise<boolean> | boolean
}

/** `RoomService`의 부분집합 — 이탈과 시작한 게임 취소. */
export interface PingPongRoomService {
  /** @returns 방·좌석이 있었는지. */
  leave(roomId: string, playerId: string): Promise<boolean> | boolean
  /** START로 세운 `gameId`·phase를 되돌린다(Lua CANCEL_ACTIVE_GAME). */
  cancelActiveGame(roomId: string): Promise<unknown> | unknown
  /**
   * 파티 방이면 랠리를 **대시보드가 판정한다**(frontend ADR-0003). 서버는 시뮬레이션을
   * 멈추고 보고받은 상태를 중계하는 쪽으로 바뀐다.
   */
  isPartyRoom(roomId: string): Promise<boolean> | boolean
}

/**
 * 종료 시 방 점수 해시에 최종 점수를 남긴다 — `game.over`의 순위 계산이 읽는
 * 값이다(`room:{code}:scores`).
 *
 * **roster에 남아 있는 플레이어만 기록해야 한다**: 몰수한 사람은 이 콜백이 돌기
 * 전에 이미 방에서 빠졌으므로, 걸러내지 않으면 지워진 점수 항목이 되살아난다.
 * 그 필터는 어댑터(`redisPingPongScoreWriter`)의 책임이다.
 */
export interface PingPongScoreWriter {
  record(roomId: string, scores: PingPongPlayerNumbers): Promise<void>
}

/**
 * 방 하나의 탁구 상태 저장소. 락·TTL·직렬화는 어댑터가, 규칙은
 * `pingPongRules.ts`가 갖는다.
 */
export interface PingPongStateStore {
  /** SETNX — 이중 초기화는 오류(`ping_pong_already_initialized`). */
  initialize(roomId: string, state: PingPongState): Promise<void>
  find(roomId: string): Promise<PingPongState | undefined>
  /**
   * 방 락 안에서 읽기 → 변이 → 쓰기. 변이가 `null`을 주거나 **version이 늘지
   * 않으면** 아무것도 쓰지 않고 `undefined`를 돌려준다(규칙 함수들이 "무시"를
   * 같은 상태 반환으로 표현하는 것과 짝이다).
   */
  mutate(
    roomId: string,
    mutation: (current: PingPongState) => PingPongState | null,
  ): Promise<PingPongState | undefined>
  remove(roomId: string): Promise<boolean>
}
