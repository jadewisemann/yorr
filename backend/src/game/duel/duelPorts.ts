/**
 * 결투 진행(3.3)이 **자기 바깥**에 요구하는 것들 — 전부 이 파일의 좁은 포트로만
 * 표현한다. 2.5(`round/roundPorts.ts`)·2.7(`completion/completionPorts.ts`)과 같은
 * 방식이고 같은 이유다.
 *
 * 결투 서비스가 `RoomBroadcaster`·`RoomSessionRegistry`·
 * `RealtimeRoomSnapshotService`·`RoundDeadlineScheduler`·`GameCompletionService`·
 * `StringRedisTemplate`을 구체 타입으로 잡는데, 그대로 옮기면
 * ① 병렬로 고쳐지는 파일(ws·room)에 컴파일이 묶이고
 * ② game-modules.md의 "도메인 규칙은 전송 계층을 모른다"를 깬다.
 *
 * 여기 선언한 인터페이스는 실제 클래스가 **구조적으로 이미 만족**하므로 어댑터가
 * 필요 없다 — `__tests__/duelPorts.contract.test.ts`가 그 대입 가능성을 고정한다.
 */

/** `ws/envelope.ts`의 `OutboundEnvelope`와 같은 모양. */
export interface DuelOutboundEnvelope {
  readonly type: string
  readonly ts: number
  readonly payload: unknown
  readonly roomId?: string | undefined
  readonly msgId?: string | undefined
}

/** `RoomBroadcaster`가 그대로 만족한다(팬아웃 1회 직렬화는 그쪽 책임). */
export interface DuelBroadcaster {
  broadcast(roomId: string, message: DuelOutboundEnvelope): void
}

/**
 * 결투가 레지스트리에 알리는 phase는 시작(`playing`)과 로비 복귀(`waiting`) 둘뿐이다.
 * 포트를 그 리터럴로 좁혀 두면 `RoomSessionRegistry.markPhase(roomId, WsRoomPhase)`가
 * 안전하게(넓은 인자 ← 좁은 인자) 대입된다.
 */
export type DuelMarkablePhase = 'playing' | 'waiting'

/**
 * `RoomSessionRegistry`의 부분집합.
 *
 * `start`에서 `markPhase('playing')`을 부르는 것이 **모듈의 계약**이다(아래
 * `YachtDiceGameModule`·`DuelGameService`가 하는 일). 빠뜨리면 진행 중 방의
 * 레지스트리 phase가 waiting에 머물러, 끊긴 플레이어가 offline 전이가 아니라
 * `room.player_left`가 된다(IMPLEMENTATION_NOTES 2.1의 「registry phase 구멍」).
 */
export interface DuelPresence {
  markPhase(roomId: string, phase: DuelMarkablePhase): void
}

/**
 * 소켓 → 방 멤버 역추적. `RoomSessionRegistry.of`가 그대로 만족한다.
 *
 * 모듈이 읽는 것은 "이 소켓이 누구이고 어느 방인가" 둘뿐이다 — 넓은 `RoomMember`에
 * 묶으면 status·nickname·host가 바뀔 때 여기가 따라 바뀔 이유가 생긴다.
 */
export interface DuelSessionLookup<S> {
  of(socket: S): { readonly playerId: string; readonly roomId: string } | null
}

/**
 * 방 마감 예약의 부분집합 — `InMemoryRoundDeadlineScheduler`가 그대로 만족한다.
 * **두 번째 인자는 라운드 번호가 아니라 `state.version`이다**(결투는 라운드
 * 프레임워크를 쓰지 않는다). 스케줄러가 요구하는 것은 "방 하나당 하나, 재예약 시
 * 앞의 것 무효"뿐이라 버전을 키로 써도 규약이 유지된다.
 */
export interface DuelDeadlineScheduler {
  schedule(
    roomId: string,
    version: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void
  cancelRoom(roomId: string): unknown
}

/**
 * 게임 종료 판정(2.7 `GameCompletionService.finishIfComplete`). 결투는 항상
 * `force=true`로 부른다 — 점수판 12칸 완료 검사는 야추의 것이라 결투에는 영원히
 * 성립하지 않는다.
 */
export interface DuelCompletionPort {
  finishIfComplete(roomId: string, force: boolean): Promise<boolean> | boolean
}

/**
 * 실시간 병합 방 스냅샷. `ws/RealtimeRoomSnapshotService`가 그대로 만족한다.
 *
 * 스냅샷의 **모양은 프레임워크(ws) 소유**이고 결투는 거기에 `game` 하나를 얹을
 * 뿐이라 타입 자체를 제네릭으로 받는다(2.8 `RealtimeRoomSnapshotPort`와 같은 경계).
 */
export interface DuelRoomSnapshotPort<S> {
  snapshot(roomId: string): Promise<S>
}

/**
 * 종료 시 점수판 기록. 구현은 roster 해시를 확인하고
 * 점수 해시에 직접 쓴다 — 그 두 동작만 포트로 남긴다.
 *
 * **방을 떠난 플레이어의 점수 항목은 되살리지 않는다**(roster에 없으면 건너뛴다).
 * 이 규칙을 어기면 이미 지워진 참가자가 순위표에 부활한다.
 */
export interface DuelScoreboardPort {
  /** @param scores playerId → 기록할 점수(잔탄). roster에 남은 플레이어만 기록된다. */
  writeScores(roomId: string, scores: ReadonlyMap<string, number>): Promise<void>
}
