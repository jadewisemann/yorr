import { ReconnectSnapshotError } from './reconnectErrors.js'
import {
  type PhasedRoomSnapshot,
  PLAYING_PHASE,
  type RealtimeRoomSnapshotPort,
  type ReconnectRoundStatePort,
  type RoundDeadlinePort,
  type ScoreboardQueryPort,
} from './reconnectPorts.js'
import { createYachtDiceState, type YachtDiceState } from './yachtDiceState.js'

export interface GameReconnectSnapshotServiceDeps<S extends PhasedRoomSnapshot> {
  readonly realtimeSnapshots: RealtimeRoomSnapshotPort<S>
  readonly roundStates: ReconnectRoundStatePort
  readonly deadlines: RoundDeadlinePort
  readonly scoreboards: ScoreboardQueryPort
}

/** 게임 상태가 실린 스냅샷 — 방 스냅샷 그대로에 `game` 하나만 얹은 모양이다. */
export type ReconnectSnapshot<S extends PhasedRoomSnapshot> =
  | S
  | (S & { readonly game: YachtDiceState })

/**
 * 재접속 응답용 방·라운드·점수 상태를 **한 시점의 전체 스냅샷**으로 조립한다.
 *
 * DESIGN.md 원칙 4: 재접속 클라이언트는 증분 이벤트로 상태를 재구성하지 않는다.
 * 그래서 이 스냅샷은 "그 시점의 화면을 그리기에 충분"해야 하고, 진행 중 턴의
 * 굴림 상태(`rollCount`·`dice`·`held`)가 그 충분성의 기준 사례다
 * (docs/design/reconnect.md 「스냅샷 내용」).
 *
 * **오프라인 결석 카운터 리셋은 여기서 하지 않는다.** Java도 `YachtDiceGameModule.
 * reconnect`가 스냅샷을 받은 **뒤에** `clearOfflineMisses`를 부른다 — 스냅샷
 * 조립이 실패하면 카운터가 남는 것이 계약이다. 3.1이 그 순서를 지켜야 한다.
 */
export class GameReconnectSnapshotService<S extends PhasedRoomSnapshot> {
  private readonly realtimeSnapshots: RealtimeRoomSnapshotPort<S>
  private readonly roundStates: ReconnectRoundStatePort
  private readonly deadlines: RoundDeadlinePort
  private readonly scoreboards: ScoreboardQueryPort

  constructor(deps: GameReconnectSnapshotServiceDeps<S>) {
    this.realtimeSnapshots = deps.realtimeSnapshots
    this.roundStates = deps.roundStates
    this.deadlines = deps.deadlines
    this.scoreboards = deps.scoreboards
  }

  /**
   * @param playerId 요청자. 점수판 조회의 권한 판정에 그대로 넘어간다.
   * @throws ReconnectSnapshotError phase가 playing인데 라운드 상태 또는 활성
   * 마감이 없을 때. 조회 순서(라운드 → 마감 → 점수판)가 Java와 같다 —
   * 먼저 걸리는 쪽이 이유 코드를 결정한다.
   */
  async snapshot(roomId: string, playerId: string): Promise<ReconnectSnapshot<S>> {
    const room = await this.realtimeSnapshots.snapshot(roomId)
    // 대기실·종료된 방은 방 스냅샷 그대로 — `game`을 붙이지 않는다. 프론트 리듀서는
    // game이 없는 스냅샷을 만나면 로컬 game을 보존한다(reconnect.md 「규칙」).
    if (room.phase !== PLAYING_PHASE) return room

    const round = await this.roundStates.findByRoomId(roomId)
    if (round === undefined) {
      throw new ReconnectSnapshotError(
        'ROUND_NOT_INITIALIZED',
        `진행 중인 방의 라운드 상태를 찾을 수 없습니다: ${roomId}`,
      )
    }

    // null은 실패가 아니다 — 시계를 걸지 않은 턴(봇만 있는 연습 방)이라는 뜻이고,
    // 그대로 스냅샷에 실어 프론트가 타이머 없이 복원하게 둔다.
    const roundDeadline = this.deadlines.currentDeadline(roomId)
    if (roundDeadline === undefined) {
      throw new ReconnectSnapshotError(
        'DEADLINE_NOT_FOUND',
        `진행 중인 방의 턴 마감 시각을 찾을 수 없습니다: ${roomId}`,
      )
    }

    const scores = await this.scoreboards.getScoreboards(roomId, playerId)
    return { ...room, game: createYachtDiceState(round, roundDeadline, scores) }
  }
}
