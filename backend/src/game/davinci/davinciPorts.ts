/**
 * 다빈치 코드 진행이 **자기 바깥**에 요구하는 것들 — 전부 이 파일의 좁은 포트로만
 * 표현한다(결투 `duelPorts.ts`와 같은 방식이고 같은 이유다). 실제 클래스가 구조적으로
 * 이미 만족하므로 어댑터가 필요 없고, `__tests__/davinciPorts.contract.test.ts`가 그
 * 대입 가능성을 고정한다.
 */

/** `ws/envelope.ts`의 `OutboundEnvelope`와 같은 모양. */
export interface DavinciOutboundEnvelope {
  readonly type: string
  readonly ts: number
  readonly payload: unknown
  readonly roomId?: string | undefined
  readonly msgId?: string | undefined
}

/** 방에 남아 있는 좌석 하나. 오프라인 좌석은 소켓이 없다. */
export interface DavinciSeat<S> {
  readonly playerId: string
  readonly socket: S | null
}

/**
 * 방 사람들에게 **한 명씩** 보내는 통로.
 *
 * 다빈치 코드만 `RoomBroadcaster`(방 전체 1회 직렬화 팬아웃)를 쓰지 않는다. 이 게임의
 * 상태는 보는 사람마다 다르기 때문이다 — 같은 프레임을 모두에게 재사용하려면 감춘
 * 숫자를 전부 실어야 하고, 그 순간 개발자 도구를 연 사람이 판을 다 안다. 좌석 수가
 * 최대 넷이라 사람 수만큼 직렬화해도 부담이 없다.
 *
 * 파티 대시보드는 방 명단에는 없지만 레지스트리 좌석에는 있으므로 여기로 함께
 * 닿는다 — 플레이어가 아니라서 감춘 숫자가 하나도 실리지 않는 관전 시점을 받는다.
 */
export interface DavinciAudience<S> {
  membersOf(roomId: string): readonly DavinciSeat<S>[]
  send(socket: S, message: DavinciOutboundEnvelope): void
}

/** 시작(`playing`)과 로비 복귀(`waiting`) 둘뿐이다(결투 `DuelMarkablePhase`와 같다). */
export type DavinciMarkablePhase = 'playing' | 'waiting'

/**
 * `RoomSessionRegistry`의 부분집합. `start`에서 `markPhase('playing')`을 부르는 것이
 * 모듈의 계약이다 — 빠뜨리면 진행 중 방의 레지스트리 phase가 waiting에 머물러 끊긴
 * 플레이어가 offline 전이가 아니라 `room.player_left`가 된다.
 */
export interface DavinciPresence {
  markPhase(roomId: string, phase: DavinciMarkablePhase): void
}

/** 소켓 → 방 멤버 역추적. `RoomSessionRegistry.of`가 그대로 만족한다. */
export interface DavinciSessionLookup<S> {
  of(socket: S): { readonly playerId: string; readonly roomId: string } | null
}

/**
 * 방 마감 예약의 부분집합 — `InMemoryRoundDeadlineScheduler`가 그대로 만족한다.
 * 두 번째 인자는 라운드 번호가 아니라 `state.version`이다(결투와 같은 이유 —
 * 라운드 프레임워크를 쓰지 않는다).
 */
export interface DavinciDeadlineScheduler {
  schedule(
    roomId: string,
    version: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void
  cancelRoom(roomId: string): unknown
}

/** 게임 종료 판정(2.7). 다빈치 코드도 결투처럼 항상 `force=true`로 부른다. */
export interface DavinciCompletionPort {
  finishIfComplete(roomId: string, force: boolean): Promise<boolean> | boolean
}

/** 실시간 병합 방 스냅샷. `ws/RealtimeRoomSnapshotService`가 그대로 만족한다. */
export interface DavinciRoomSnapshotPort<S> {
  snapshot(roomId: string): Promise<S>
}

/** 종료 시 점수판 기록. 방 명단에 없는(떠난) 플레이어의 점수는 되살리지 않는다. */
export interface DavinciScoreboardPort {
  writeScores(roomId: string, scores: ReadonlyMap<string, number>): Promise<void>
}
