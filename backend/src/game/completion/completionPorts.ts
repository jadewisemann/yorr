import type { Ranking } from './gameResultCalculator.js'

/**
 * 게임 종료 서비스가 **자기 바깥**에 요구하는 것들 — 전부 이 파일의 좁은
 * 포트로만 표현한다. `round/roundPorts.ts`와 같은 방식이고 같은 이유다.
 *
 * 방·브로드캐스터·레지스트리·스냅샷·스케줄러·전적 보관을 구체 타입으로 잡으면
 * ① 함께 고쳐지는 파일(ws·room·match)에 컴파일이 묶이고
 * ② game-modules.md의 "도메인 규칙은 전송 계층을 모른다"를 깬다.
 *
 * 여기 선언한 인터페이스는 실제 클래스가 **구조적으로 이미 만족**하므로 어댑터가
 * 필요 없다 — `__tests__/completionPorts.contract.test.ts`가 그 대입 가능성을 고정한다.
 */

/** `ws/envelope.ts`의 `OutboundEnvelope`와 같은 모양. */
export interface CompletionOutboundEnvelope {
  readonly type: string
  readonly ts: number
  readonly payload: unknown
  readonly roomId?: string | undefined
  readonly msgId?: string | undefined
}

/** `RoomBroadcaster`가 그대로 만족한다. */
export interface CompletionBroadcaster {
  broadcast(roomId: string, message: CompletionOutboundEnvelope): void
}

/**
 * 종료가 레지스트리에 알리는 phase는 **`finished` 하나뿐**이다. 포트를 그 리터럴로
 * 좁혀 두면 `RoomSessionRegistry.markPhase(roomId, WsRoomPhase)`가 안전하게(넓은
 * 인자 ← 좁은 인자) 대입된다.
 */
export type CompletionPhase = 'finished'

/** `RoomSessionRegistry`의 부분집합. */
export interface CompletionPresence {
  markPhase(roomId: string, phase: CompletionPhase): void
}

/** 마감 스케줄러의 부분집합 — `InMemoryRoundDeadlineScheduler`가 그대로 만족한다. */
export interface CompletionDeadlineScheduler {
  /** 그 방에 걸린 마감을 전부 취소한다. 종료 직후 만료가 한 번 더 돌면 다음 턴이 시작된다. */
  cancelRoom(roomId: string): unknown
}

interface CompletionPlayerSnapshot {
  readonly playerId: string
  readonly nickname: string
  readonly kind: string
}

/**
 * 종료가 방 스냅샷에서 읽는 것 + **전적 보관(4.4)이 필요로 하는 것**.
 * `RoomSnapshot`이 그대로 만족한다(닉네임은 순위 payload에 없어서 여기서 온다).
 */
export interface CompletionRoomSnapshot {
  readonly roomCode: string | null
  readonly gameCode: string | null
  readonly gameId: string | null
  readonly players: readonly CompletionPlayerSnapshot[]
}

/** `RoomService`의 부분집합. */
export interface CompletionRoomService {
  getSnapshot(roomId: string): Promise<CompletionRoomSnapshot | null>
}

/** `RealtimeRoomSnapshotService`의 부분집합 — 내용은 해석하지 않고 그대로 싣는다. */
export interface CompletionSnapshotService {
  snapshot(roomId: string): Promise<unknown>
}

/**
 * 전적 보관의 자리 — `MatchArchiveService`가 채운다.
 *
 * 반환값("실제로 저장했는지")을 종료 경로는 쓰지 않는다. 그래서 `unknown`으로
 * 열어 둔다 — 구현이 `Promise<boolean>`을 돌려주든 아무것도 돌려주지 않든 이
 * 포트를 만족한다(`round/roundPorts.ts`의 `touch`와 같은 규약).
 */
export interface MatchArchivePort {
  archive(room: CompletionRoomSnapshot, rankings: readonly Ranking[]): Promise<unknown> | unknown
}

/**
 * ⬛ **스텁 자리 — 4.4가 이것을 실제 `MatchArchiveService`로 교체한다.**
 *
 * 아무것도 하지 않는다. 지금 전적 테이블에 쓸 것이 없기 때문이지, 종료 경로가
 * 보관을 몰라도 되기 때문이 아니다. 배선(`server.ts`)에서 이 상수를 실제 구현으로
 * 바꾸는 것 말고 **다른 변경은 필요 없어야 한다** — 그래서 호출 지점·오류 삼킴이
 * 이미 서비스 안에 들어 있다.
 */
export const noopMatchArchive: MatchArchivePort = {
  archive: () => false,
}
