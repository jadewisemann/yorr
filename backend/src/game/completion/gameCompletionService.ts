import { gameWsType } from '../module.js'
import type {
  CompletionBroadcaster,
  CompletionDeadlineScheduler,
  CompletionPresence,
  CompletionRoomService,
  CompletionRoomSnapshot,
  CompletionSnapshotService,
  MatchArchivePort,
} from './completionPorts.js'
import { noopMatchArchive } from './completionPorts.js'
import type { GameCompletionStore } from './completionStore.js'
import { type Ranking, rankTotals } from './gameResultCalculator.js'

export interface GameCompletionServiceDeps {
  readonly completionStore: GameCompletionStore
  readonly deadlineScheduler: CompletionDeadlineScheduler
  readonly roomService: CompletionRoomService
  readonly presence: CompletionPresence
  readonly realtimeSnapshots: CompletionSnapshotService
  readonly broadcaster: CompletionBroadcaster
  /** 생략하면 `noopMatchArchive` — **4.4가 실제 구현으로 채운다**. */
  readonly matchArchive?: MatchArchivePort
}

export interface GameCompletionServiceOptions {
  /** 전적 보관 실패의 관측 훅(Java `log.error`). 종료는 그대로 진행한다. */
  readonly onArchiveFailure?: (roomId: string, error: unknown) => void
  /** 종료 성사 알림(Java `log.info("game.over: ...")`). */
  readonly onFinished?: (event: GameFinishedEvent) => void
}

export interface GameFinishedEvent {
  readonly roomId: string
  readonly gameId: string
  readonly force: boolean
  readonly rankings: readonly Ranking[]
}

/**
 * 게임 종료 단일 진입점. 종료 판정·전이·방송이
 * 여기 한 곳에만 있다(docs/design/game-modules.md 「게임 종료」).
 *
 * 순서가 계약이다: **① CAS 전이 → ② 타이머 정지 → ③ 방송**.
 * - ①이 실패하면(= 다른 호출이 이미 끝냈다) **아무 부수효과도 남기지 않는다** —
 * 방송도, 타이머 취소도, phase 표시도 하지 않는다. 이것이 `game.over` 정확히
 * 1회의 구조적 보장이다.
 * - 판정이 성립하기 전에 타이머를 멈추면 진행 중인 게임이 멈춘다. 그래서 취소는
 * 반드시 전이가 성공한 뒤다(Java의 주석과 순서를 그대로 옮겼다).
 * - 방송은 `game.over` → `state.sync` 순서다. phase(finished)는 스냅샷으로만
 * 전달되므로 뒤엣것을 빼면 클라이언트가 결과 화면으로 넘어가지 못한다.
 *
 * `round/roundPorts.ts`의 `GameCompletionPort`를 구조적으로 만족한다 — 타이머(2.5)에
 * 어댑터 없이 그대로 꽂힌다.
 */
export class GameCompletionService {
  private readonly completionStore: GameCompletionStore
  private readonly deadlineScheduler: CompletionDeadlineScheduler
  private readonly roomService: CompletionRoomService
  private readonly presence: CompletionPresence
  private readonly realtimeSnapshots: CompletionSnapshotService
  private readonly broadcaster: CompletionBroadcaster
  private readonly matchArchive: MatchArchivePort
  private readonly options: GameCompletionServiceOptions

  constructor(deps: GameCompletionServiceDeps, options: GameCompletionServiceOptions = {}) {
    this.completionStore = deps.completionStore
    this.deadlineScheduler = deps.deadlineScheduler
    this.roomService = deps.roomService
    this.presence = deps.presence
    this.realtimeSnapshots = deps.realtimeSnapshots
    this.broadcaster = deps.broadcaster
    this.matchArchive = deps.matchArchive ?? noopMatchArchive
    this.options = options
  }

  /**
   * 게임이 끝났으면 종료 처리하고 방에 알린다.
   *
   * @param force 라운드 상한에 도달했는지. true면 점수판에 빈 칸이 남아도 종료한다(안전망).
   * false면 "전원 점수판 12칸 완료"라는 저장소 판정에만 따른다.
   * @returns 이 호출이 게임을 종료시켰는지. false면 아직 진행 중이므로 다음 턴을 시작해야 한다.
   */
  async finishIfComplete(roomId: string, force: boolean): Promise<boolean> {
    const room = await this.roomService.getSnapshot(roomId)
    const gameId = room?.gameId
    if (!room || !gameId || gameId.trim().length === 0) return false

    if (!(await this.completionStore.finishIfComplete(roomId, gameId, force))) return false

    this.deadlineScheduler.cancelRoom(roomId)
    this.presence.markPhase(roomId, 'finished')

    const rankings = rankTotals(await this.completionStore.readTotals(roomId))
    await this.archive(roomId, room, rankings)

    this.broadcaster.broadcast(roomId, {
      type: gameWsType(room.gameCode, 'game.over'),
      ts: Date.now(),
      payload: { rankings },
      roomId,
    })
    // phase(finished)는 스냅샷으로만 전달된다 — 이걸 빼면 클라가 결과 화면으로 넘어가지 못한다.
    this.broadcaster.broadcast(roomId, {
      type: gameWsType(room.gameCode, 'state.sync'),
      ts: Date.now(),
      payload: { snapshot: await this.realtimeSnapshots.snapshot(roomId) },
      roomId,
    })

    this.options.onFinished?.({ roomId, gameId, force, rankings })
    return true
  }

  /**
   * 결과를 DB에 남긴다. **실패해도 게임 종료를 막지 않는다** — 저장은 나중에 되짚기
   * 위한 것이고, 여기서 예외가 올라가면 눈앞의 사용자가 결과 화면으로 넘어가지
   * 못한다. 그쪽 손해가 훨씬 크다.
   *
   * ⬛ 지금 주입되는 것은 `noopMatchArchive` 스텁이다 — **4.4가 교체한다**.
   */
  private async archive(
    roomId: string,
    room: CompletionRoomSnapshot,
    rankings: readonly Ranking[],
  ): Promise<void> {
    try {
      await this.matchArchive.archive(room, rankings)
    } catch (error) {
      this.options.onArchiveFailure?.(roomId, error)
    }
  }
}
