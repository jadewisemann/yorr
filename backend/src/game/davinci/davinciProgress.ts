import { gameWsType } from '../module.js'
import { DAVINCI_CODE } from './davinciCode.js'
import type {
  DavinciAudience,
  DavinciCompletionPort,
  DavinciDeadlineScheduler,
  DavinciRoomSnapshotPort,
  DavinciScoreboardPort,
} from './davinciPorts.js'
import { scoreOf } from './davinciRules.js'
import { type DavinciState, type DavinciView, toView } from './davinciState.js'

/**
 * 다빈치 코드에서 상태가 바뀐 **뒤의 일** — 좌석별 방송, 마감 재예약, 종료 정산.
 *
 * 서비스(`davinciGameService.ts`)에서 갈라 둔 이유는 결투의 `duelProgress.ts`와 같다:
 * "판이 어떻게 흘러가는가"와 "그 사실을 좌석마다 어떻게 전하는가"는 다른 관심사다.
 * 이 게임은 **payload가 보는 사람마다 다르므로**(손패를 가린다) 방송 로직이 특히
 * 무겁다 — 한 프레임을 재사용할 수 없어 좌석마다 `toView`를 다시 만든다.
 *
 * 종료 순서가 계약이다: 예약 취소 → 점수 기록 → 완료 판정 → 방송(스냅샷 동봉).
 */
export interface DavinciProgressDeps<S, K> {
  readonly scheduler: DavinciDeadlineScheduler
  readonly audience: DavinciAudience<K>
  readonly snapshots: DavinciRoomSnapshotPort<S>
  readonly scoreboard: DavinciScoreboardPort
  readonly completion: DavinciCompletionPort
}

export class DavinciProgress<S, K> {
  constructor(
    private readonly deps: DavinciProgressDeps<S, K>,
    private readonly now: () => number,
    /** 마감이 발화했을 때 부를 것 — 서비스가 자기 전이를 꽂는다. */
    private readonly onExpire: (roomId: string, expectedVersion: number) => void | Promise<void>,
  ) {}

  /**
   * 상태가 바뀌었다. 진행 중이면 좌석별 방송 + 다음 마감 예약, 끝났으면 정산이다.
   *
   * 턴이 넘어간 프레임에서만 방 스냅샷을 함께 보낸다 — 매 입력마다 덧붙이면 진행 중
   * 화면이 계속 재조립된다(결투 `changed`와 같은 기준).
   */
  async changed(roomId: string, state: DavinciState): Promise<void> {
    if (state.phase !== 'FINISHED') {
      await this.broadcast(roomId, state, state.lastEvent?.kind === 'FORFEIT')
      this.schedule(roomId, state)
      return
    }

    this.deps.scheduler.cancelRoom(roomId)
    const scores = new Map<string, number>()
    for (const playerId of state.playerOrder) {
      scores.set(playerId, scoreOf(state, playerId))
    }
    await this.deps.scoreboard.writeScores(roomId, scores)
    // 다빈치 코드에 "점수판 완료"는 없다 — 종료 판정은 항상 강제다.
    await this.deps.completion.finishIfComplete(roomId, true)
    await this.broadcast(roomId, state, true)
  }

  /** 마감 예약. 끝난 판이나 마감이 없는 상태는 걸지 않는다. */
  schedule(roomId: string, state: DavinciState): void {
    if (state.phase === 'FINISHED' || state.nextActionAt <= 0) return
    const version = state.version
    this.deps.scheduler.schedule(roomId, version, state.nextActionAt, () =>
      this.onExpire(roomId, version),
    )
  }

  /** 로비 복귀 — 게임 상태를 버린 뒤 대기실 스냅샷을 모든 좌석에 다시 뿌린다. */
  async syncRoom(roomId: string): Promise<void> {
    const snapshot = await this.deps.snapshots.snapshot(roomId)
    this.sendToAll(roomId, () => ({
      type: gameWsType(DAVINCI_CODE, 'state.sync'),
      ts: this.now(),
      payload: { snapshot },
      roomId,
    }))
  }

  /**
   * `game.davinci_code.state`는 **보는 사람 기준으로 깎은 뷰**를 그대로 싣는다.
   * 좌석마다 payload가 다르므로 한 프레임을 재사용할 수 없다.
   */
  async broadcast(
    roomId: string,
    state: DavinciState,
    includeRoomSnapshot: boolean,
  ): Promise<void> {
    this.sendToAll(roomId, (playerId) => ({
      type: gameWsType(DAVINCI_CODE, 'state'),
      ts: this.now(),
      payload: toView(state, playerId),
      roomId,
    }))
    if (!includeRoomSnapshot) return
    const room = await this.deps.snapshots.snapshot(roomId)
    this.sendToAll(roomId, (playerId) => ({
      type: gameWsType(DAVINCI_CODE, 'state.sync'),
      ts: this.now(),
      payload: { snapshot: { ...room, game: toView(state, playerId) } },
      roomId,
    }))
  }

  async snapshot(
    roomId: string,
    state: DavinciState,
    viewerId: string,
  ): Promise<S & { game: DavinciView }> {
    const room = await this.deps.snapshots.snapshot(roomId)
    return { ...room, game: toView(state, viewerId) }
  }

  private sendToAll(
    roomId: string,
    frame: (playerId: string) => {
      type: string
      ts: number
      payload: unknown
      roomId: string
    },
  ): void {
    for (const seat of this.deps.audience.membersOf(roomId)) {
      if (seat.socket === null) continue
      this.deps.audience.send(seat.socket, frame(seat.playerId))
    }
  }
}
