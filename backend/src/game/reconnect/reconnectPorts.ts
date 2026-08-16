/**
 * 재접속 스냅샷·고아 상태 스윕(2.8)이 **자기 바깥**에 요구하는 것들 — 전부 이
 * 파일의 좁은 포트로만 표현한다.
 *
 * 왜 포트인가: Java `GameReconnectSnapshotService`/`OrphanedRoundStateSweeper`는
 * `RealtimeRoomSnapshotService`·`RoundSynchronizationService`·`RoundTimerService`·
 * `GameScoreQueryService`·`RoomService`를 구체 타입으로 직접 잡는다. 2.5가
 * `round/roundPorts.ts`에서 같은 이유로 뒤집었듯이 여기서도 뒤집는다:
 * ① 아직 없는 계층(조회 REST 2.9의 `GameScoreQueryService`)에 컴파일 의존을
 * 만들지 않고 ② 재접속 모듈이 전송 계층(ws/room)을 모르게 한다.
 *
 * 여기 선언된 인터페이스는 실제 구현이 **구조적으로 이미 만족**하므로 어댑터
 * 코드가 필요 없다(`__tests__/reconnectPorts.contract.test.ts`가 대입 가능성을
 * 고정한다).
 */

/**
 * WS 스냅샷의 진행 중 phase 문자열. **소문자가 계약이다**(`ws/protocol.ts`의
 * `WsRoomPhase` — Redis의 대문자 `PLAYING`과 다르다).
 */
export const PLAYING_PHASE = 'playing'

/**
 * 재접속 서비스가 방 스냅샷에서 **유일하게 읽는** 필드.
 *
 * 나머지 필드는 해석하지 않고 그대로 통과시키므로 스냅샷 타입 자체를 제네릭으로
 * 받는다 — 방 스냅샷의 모양은 프레임워크(ws) 소유이고, 재접속은 거기에 `game`
 * 하나를 얹는 역할만 한다(docs/design/reconnect.md 「규칙」).
 */
export interface PhasedRoomSnapshot {
  readonly phase: string
}

/** `ws/RealtimeRoomSnapshotService`가 그대로 만족한다(실시간 병합 스냅샷). */
export interface RealtimeRoomSnapshotPort<S extends PhasedRoomSnapshot> {
  snapshot(roomId: string): Promise<S>
}

/**
 * 재접속 스냅샷이 라운드 상태에서 읽는 것만. `round/RoundState`가 그대로 만족한다
 * (`activePlayerId`는 Java의 파생 메서드 자리인 getter라 구조적으로 프로퍼티다).
 *
 * `activeRollCount`·`activeDice`·`activeHeld`가 여기 있는 이유가 이 티켓의 핵심이다:
 * 진행 중 턴의 굴림 상태가 스냅샷에서 빠지면 복귀한 클라이언트가 굴림 수를 0부터
 * 세고, 다음 `dice.roll`이 서버의 `activeRollCount`와 어긋나 거부된다.
 */
export interface ReconnectRoundState {
  readonly roundNumber: number
  readonly activePlayerId: string
  readonly participantOrder: readonly string[]
  readonly activeRollCount: number
  /** 첫 굴림 전에는 null → 스냅샷에서 생략된다. */
  readonly activeDice: readonly number[] | null
  /** 첫 굴림 전에는 null → 스냅샷에서 생략된다. */
  readonly activeHeld: readonly boolean[] | null
}

/** `RoundSynchronizationService.findByRoomId`의 자리. */
export interface ReconnectRoundStatePort {
  findByRoomId(roomId: string): Promise<ReconnectRoundState | undefined>
}

/**
 * 스윕이 쓰는 라운드 상태 목록·회수 — `RoundSynchronizationService`가 그대로
 * 만족한다(`roomIds`/`remove`는 2.5가 이 티켓을 위해 남긴 표면이다).
 */
export interface OrphanedRoundStatePort {
  /** 라운드 상태를 들고 있는 모든 방. 순회 중 `remove`를 부르므로 **복사본**이어야 한다. */
  roomIds(): Promise<readonly string[]>
  remove(roomId: string): Promise<unknown>
}

/**
 * `RoundTimerService.currentDeadline`의 자리 — 현재 턴의 마감 시각(epoch ms).
 * 활성 마감이 없으면 undefined(Java `Optional.empty()`).
 */
export interface RoundDeadlinePort {
  currentDeadline(roomId: string): number | undefined
}

/** `RoundTimerService.cancelRoom`의 자리 — 방의 마감 예약·오프라인 카운터를 버린다. */
export interface RoundTimerCancelPort {
  cancelRoom(roomId: string): void
}

/**
 * playerId → 점수판. **`Map`과 평범한 객체를 모두 받는다.**
 *
 * 2.9의 `GameScoreQueryService.getScoreboards`는 `ReadonlyMap`을 돌려준다
 * (playerId 오름차순을 스토어가 정한 순서 그대로 보존하려고). Java의
 * `Map<String, ScoreBoard>`는 Jackson이 JSON 객체로 직렬화하지만 **JS의 `Map`은
 * `JSON.stringify`가 `{}`로 만든다** — 그대로 스냅샷에 실으면 점수판이 통째로
 * 사라진다. 그래서 포트가 둘 다 받고 `createYachtDiceState`가 평범한 객체로
 * 정규화한다(REST 라우트가 같은 이유로 같은 변환을 한다).
 */
export type ScoreboardsByPlayer = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>

/**
 * 점수판 조회(Java `GameScoreQueryService.getScoreboards`, 우리는 2.9)의 자리.
 *
 * 반환값의 **내용은 해석하지 않는다** — 재접속은 점수판을 스냅샷에 그대로 실어
 * 보낼 뿐이라 `ScoreBoard` 도메인 타입에 묶일 이유가 없다(2.5 `ConfirmedScore.
 * scoreboard: unknown`과 같은 경계).
 *
 * Java는 동기지만 우리 조회는 Redis라 Promise가 된다 — 둘 다 받는다.
 */
export interface ScoreboardQueryPort {
  getScoreboards(
    roomId: string,
    requesterId: string,
  ): Promise<ScoreboardsByPlayer> | ScoreboardsByPlayer
}

/**
 * 스윕이 방 생존을 판정할 때 읽는 것만. `RoomService`가 그대로 만족한다.
 *
 * **없는 방은 404가 아니라 `phase: null` 스냅샷이다**(`room/snapshot.ts`의
 * `roomNotFound`) — 그 null이 곧 "방이 사라졌다"의 판정 기준이다. 구현이 null
 * 자체를 돌려주는 경우도 같게 취급한다.
 */
export interface SweeperRoomService {
  getSnapshot(roomId: string): Promise<{ readonly phase: string | null } | null>
}
