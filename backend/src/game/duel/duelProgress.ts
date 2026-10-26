import { gameWsType } from '../module.js'
import { DUEL_CODE } from './duelCode.js'
import type {
  DuelBroadcaster,
  DuelCompletionPort,
  DuelDeadlineScheduler,
  DuelRoomSnapshotPort,
  DuelScoreboardPort,
} from './duelPorts.js'
import type { DuelState } from './duelState.js'

/**
 * 결투 상태가 바뀐 **뒤의 일** — 방송, 마감 재예약, 종료 정산.
 *
 * 규칙 전이(`duelRules.ts`)도 아니고 입력 검증(`duelGameService.ts`)도 아닌 세 번째
 * 관심사다. "판이 어떻게 흘러가는가"와 "그 사실을 누구에게 어떻게 알리는가"를 한
 * 클래스에 두면 읽는 사람이 둘을 번갈아 붙잡아야 하고, 파일 단위 할스테드 난이도도
 * 상한을 넘는다.
 *
 * 종료 순서가 계약이다: 예약 취소 → 점수 기록 → 완료 판정 → 방송(스냅샷 동봉).
 * 점수를 완료 판정보다 **먼저** 써야 `game.over`의 순위가 최종 점수를 본다.
 */
export interface DuelProgressDeps<S> {
  readonly scheduler: DuelDeadlineScheduler
  readonly broadcaster: DuelBroadcaster
  readonly snapshots: DuelRoomSnapshotPort<S>
  readonly scoreboard: DuelScoreboardPort
  readonly completion: DuelCompletionPort
}

export class DuelProgress<S> {
  constructor(
    private readonly deps: DuelProgressDeps<S>,
    private readonly now: () => number,
    /** 마감이 발화했을 때 부를 것 — 서비스가 자기 전이를 꽂는다. */
    private readonly onExpire: (roomId: string, expectedVersion: number) => void | Promise<void>,
  ) {}

  /**
   * 상태가 바뀌었다. 진행 중이면 방송 + 다음 마감 예약, 끝났으면 정산이다.
   *
   * WAITING(새 라운드)에서만 방 스냅샷을 함께 보낸다 — 라운드 경계가 아닌 프레임에서
   * 스냅샷을 덧붙이면 진행 중 화면이 매번 재조립된다.
   */
  async changed(roomId: string, state: DuelState): Promise<void> {
    if (state.phase !== 'FINISHED') {
      await this.broadcastState(roomId, state, state.phase === 'WAITING')
      this.schedule(roomId, state)
      return
    }

    this.deps.scheduler.cancelRoom(roomId)
    // 남은 총알이 그대로 점수다. 단 쓰러진 쪽은 0으로 내린다 — 부정출발 실격은
    // 총알이 남은 채로 지므로(SELF_SHOT은 hp를 1만 깎는다), 남은 수를 그대로 쓰면
    // 순위가 뒤집힌다.
    const fallen = state.lastRound?.koId ?? null
    const scores = new Map<string, number>()
    for (const [playerId, remaining] of Object.entries(state.hp)) {
      scores.set(playerId, playerId === fallen ? 0 : remaining)
    }
    await this.deps.scoreboard.writeScores(roomId, scores)
    // 결투에 "점수판 완료"는 없다 — 종료 판정은 항상 강제다.
    await this.deps.completion.finishIfComplete(roomId, true)
    await this.broadcastState(roomId, state, true)
  }

  /** 마감 예약. 끝난 판이나 마감이 없는 상태는 걸지 않는다. */
  schedule(roomId: string, state: DuelState): void {
    if (state.phase === 'FINISHED' || state.nextActionAt <= 0) return
    const version = state.version
    this.deps.scheduler.schedule(roomId, version, state.nextActionAt, () =>
      this.onExpire(roomId, version),
    )
  }

  /** 로비 복귀용 — 게임 상태 없이 방 스냅샷만 다시 뿌린다. */
  async syncRoom(roomId: string): Promise<void> {
    this.deps.broadcaster.broadcast(roomId, {
      type: gameWsType(DUEL_CODE, 'state.sync'),
      ts: this.now(),
      payload: { snapshot: await this.deps.snapshots.snapshot(roomId) },
      roomId,
    })
  }

  /** `game.duel.state`는 **DuelState를 그대로** 싣는다(래핑 없음 — 와이어 계약). */
  async broadcastState(
    roomId: string,
    state: DuelState,
    includeRoomSnapshot: boolean,
  ): Promise<void> {
    this.deps.broadcaster.broadcast(roomId, {
      type: gameWsType(DUEL_CODE, 'state'),
      ts: this.now(),
      payload: state,
      roomId,
    })
    if (!includeRoomSnapshot) return
    this.deps.broadcaster.broadcast(roomId, {
      type: gameWsType(DUEL_CODE, 'state.sync'),
      ts: this.now(),
      payload: { snapshot: await this.snapshot(roomId, state) },
      roomId,
    })
  }

  async snapshot(roomId: string, state: DuelState): Promise<S & { game: DuelState }> {
    const room = await this.deps.snapshots.snapshot(roomId)
    return { ...room, game: state }
  }
}
