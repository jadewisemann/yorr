import { YACHT_DICE } from '../catalog.js'
import { gameWsType } from '../module.js'
import type {
  ConfirmedScore,
  OpenCategoriesPort,
  RoundBroadcaster,
  RoundRoomService,
  ScoreRoundSubmissionPort,
} from './roundPorts.js'
import type { RoundState, RoundSubmissionResult } from './roundState.js'
import type { RoundSynchronizationService } from './roundSynchronizationService.js'

/**
 * 마감 시각이 지난 턴을 서버가 어떻게 처리했는지. 타이머는 이 결과만 보고 다음 동작을 정한다.
 *
 * Java는 `record RoundTimeoutResolution(Kind, RoundSubmissionResult, RoundState)`로
 * **두 필드 중 하나만 채우고 나머지는 null**이었다(kind를 보지 않고 꺼내면 NPE).
 * 여기서는 판별 유니온이라 그 규약을 타입이 강제한다 — Java의 정적 팩터리 3개가
 * 하던 null 검사가 컴파일 타임으로 올라간다.
 */
export type RoundTimeoutResolution =
  /** 그 사이 플레이어가 직접 제출해 턴이 이미 넘어갔다 — 아무것도 하지 않는다. */
  | { readonly kind: 'STALE' }
  /** 굴림이 남아 있어 서버가 한 번 대신 굴렸다. 턴 주인은 그대로, 시간만 다시 준다. */
  | { readonly kind: 'AUTO_ROLLED'; readonly rolled: RoundState }
  /** 굴림을 다 써서 서버가 점수를 기록하고 턴을 넘겼다. */
  | { readonly kind: 'ADVANCED'; readonly advanced: RoundSubmissionResult }

export const staleResolution = (): RoundTimeoutResolution => ({ kind: 'STALE' })

/** 굴린 뒤 상태를 함께 넘긴다 — 같은 턴에 다시 걸 round.start가 턴 순서를 실어야 한다. */
export const autoRolledResolution = (rolled: RoundState): RoundTimeoutResolution => ({
  kind: 'AUTO_ROLLED',
  rolled,
})

export const advancedResolution = (advanced: RoundSubmissionResult): RoundTimeoutResolution => ({
  kind: 'ADVANCED',
  advanced,
})

/**
 * 타이머가 해소기에 요구하는 전부. 타이머 테스트가 해소 결과를 고정할 수 있어야 하고
 * (Java는 `mock(RoundTimeoutResolver.class)`), 구현 클래스는 private 필드 때문에
 * 구조적으로 대체할 수 없다 — TS에서 private 멤버는 명목 타입이다.
 */
export interface RoundTimeoutResolverPort {
  resolve(
    roomId: string,
    roundNumber: number,
    activePlayerId: string,
  ): Promise<RoundTimeoutResolution>
}

/** 남은 족보 개수를 받아 고를 인덱스를 돌려준다. 테스트에서 선택을 고정하기 위한 시임. */
export type CategoryPicker = (bound: number) => number

export interface RoundTimeoutResolverOptions {
  readonly now?: () => number
  readonly categoryPicker?: CategoryPicker
  readonly gameCode?: string
  /** 강등 경로(점수 없이 진행)를 관측하기 위한 훅. Java의 `log.warn` 자리. */
  readonly onDegraded?: (roomId: string, reason: string, error?: unknown) => void
}

export interface RoundTimeoutResolverDeps {
  readonly synchronizationService: RoundSynchronizationService
  readonly scoreRoundSubmission: ScoreRoundSubmissionPort<RoundSubmissionResult>
  readonly openCategories: OpenCategoriesPort
  readonly roomService: RoundRoomService
  readonly broadcaster: RoundBroadcaster
}

/**
 * 마감 시각이 지난 턴을 서버가 대신 진행한다(backend-java `RoundTimeoutResolver`).
 *
 * 예전에는 마감 시 턴만 넘겼고 점수 기록은 클라이언트의 자동 제출에 의존했다. 그래서
 * 한 번도 굴리지 않았거나 탭이 백그라운드로 내려간 플레이어는 그 라운드 점수판이
 * 비어버렸다. 이제 서버가 끝까지 책임진다:
 *
 * 1. 굴림이 남아 있으면 마지막 KEEP을 유지한 채 한 번 대신 굴리고, 같은 턴에 시간을 다시 준다.
 * 2. 굴림을 다 썼으면 아직 비어 있는 족보 중 하나를 골라 기록하고 다음 턴으로 넘긴다.
 *
 * 어떤 경로로도 점수를 기록할 수 없을 때만(게임을 못 찾음·점수판 조회 실패·빈 족보 없음)
 * 마지막 수단으로 점수 없이 턴을 넘긴다 — **라운드 진행은 어떤 저장 실패에도 멈추지 않는다**.
 */
export class RoundTimeoutResolver implements RoundTimeoutResolverPort {
  private readonly synchronizationService: RoundSynchronizationService
  private readonly scoreRoundSubmission: ScoreRoundSubmissionPort<RoundSubmissionResult>
  private readonly openCategories: OpenCategoriesPort
  private readonly roomService: RoundRoomService
  private readonly broadcaster: RoundBroadcaster
  private readonly now: () => number
  private readonly categoryPicker: CategoryPicker
  private readonly gameCode: string
  private readonly onDegraded: (roomId: string, reason: string, error?: unknown) => void

  constructor(deps: RoundTimeoutResolverDeps, options: RoundTimeoutResolverOptions = {}) {
    this.synchronizationService = deps.synchronizationService
    this.scoreRoundSubmission = deps.scoreRoundSubmission
    this.openCategories = deps.openCategories
    this.roomService = deps.roomService
    this.broadcaster = deps.broadcaster
    this.now = options.now ?? Date.now
    this.categoryPicker =
      options.categoryPicker ?? ((bound) => Math.floor(Math.random() * Math.max(1, bound)))
    this.gameCode = options.gameCode ?? YACHT_DICE
    this.onDegraded = options.onDegraded ?? (() => {})
  }

  async resolve(
    roomId: string,
    roundNumber: number,
    activePlayerId: string,
  ): Promise<RoundTimeoutResolution> {
    const autoRolled = await this.synchronizationService.autoRoll(
      roomId,
      roundNumber,
      activePlayerId,
    )
    if (autoRolled !== undefined) {
      this.broadcastAutoRoll(roomId, activePlayerId, autoRolled)
      return autoRolledResolution(autoRolled)
    }

    // 자동 굴림이 안 됐다 = 턴이 이미 넘어갔거나 굴림을 다 썼다. 둘을 구분해야 한다.
    const current = await this.synchronizationService.findByRoomId(roomId)
    if (
      current === undefined ||
      current.finished ||
      current.roundNumber !== roundNumber ||
      current.activePlayerId !== activePlayerId
    ) {
      return staleResolution()
    }
    return this.recordAndAdvance(roomId, roundNumber, activePlayerId, current.activeDice)
  }

  private async recordAndAdvance(
    roomId: string,
    roundNumber: number,
    activePlayerId: string,
    dice: readonly number[] | null,
  ): Promise<RoundTimeoutResolution> {
    if (dice === null) {
      // 굴림을 다 썼는데 주사위가 없을 수는 없다. 상태가 깨졌다는 뜻이라 턴만 넘긴다.
      this.onDegraded(roomId, 'no_dice_on_expired_turn')
      return this.advanceWithoutScore(roomId, roundNumber, activePlayerId)
    }

    let category: string | null
    try {
      category = await this.pickOpenCategory(roomId, activePlayerId)
    } catch (error) {
      this.onDegraded(roomId, 'open_categories_unavailable', error)
      return this.advanceWithoutScore(roomId, roundNumber, activePlayerId)
    }
    if (category === null) {
      return this.advanceWithoutScore(roomId, roundNumber, activePlayerId)
    }

    try {
      const result = await this.scoreRoundSubmission.submit(roomId, activePlayerId, {
        roundNumber,
        dice,
        category,
      })
      if (result.score !== null) this.broadcastScoreUpdate(roomId, result.score)
      return advancedResolution(result.round)
    } catch (error) {
      // 점수를 남기지 못해도 턴은 멈추지 않는다 — 게임이 여기서 굳으면 아무도 진행할 수 없다.
      this.onDegraded(roomId, 'auto_score_failed', error)
      return this.advanceWithoutScore(roomId, roundNumber, activePlayerId)
    }
  }

  /** 아직 비어 있는 족보 중 하나. 게임을 찾지 못하거나 남은 족보가 없으면 null. */
  private async pickOpenCategory(roomId: string, playerId: string): Promise<string | null> {
    const room = await this.roomService.getSnapshot(roomId)
    const gameId = room?.gameId ?? null
    if (gameId === null || gameId.trim().length === 0) {
      this.onDegraded(roomId, 'game_not_found')
      return null
    }
    const open = await this.openCategories.openCategories(gameId, playerId)
    if (open.length === 0) {
      this.onDegraded(roomId, 'no_open_category')
      return null
    }
    // Java `Math.floorMod` — 음수 인덱스를 돌려주는 picker에도 범위 안으로 접는다.
    const index = ((this.categoryPicker(open.length) % open.length) + open.length) % open.length
    return open[index] ?? null
  }

  private async advanceWithoutScore(
    roomId: string,
    roundNumber: number,
    activePlayerId: string,
  ): Promise<RoundTimeoutResolution> {
    const expired = await this.synchronizationService.expire(roomId, roundNumber, activePlayerId)
    return expired === undefined ? staleResolution() : advancedResolution(expired)
  }

  private broadcastAutoRoll(roomId: string, activePlayerId: string, state: RoundState): void {
    this.broadcaster.broadcast(roomId, {
      type: gameWsType(this.gameCode, 'dice.broadcast'),
      ts: this.now(),
      payload: {
        playerId: activePlayerId,
        roundNumber: state.roundNumber,
        rollCount: state.activeRollCount,
        dice: state.activeDice ?? [],
        held: state.activeHeld ?? [],
        // 클라이언트는 이 값이 true면 자기가 보낸 dice.roll의 응답이 아니어도 그대로 반영한다.
        auto: true,
      },
      roomId,
    })
  }

  private broadcastScoreUpdate(roomId: string, score: ConfirmedScore): void {
    this.broadcaster.broadcast(roomId, {
      type: gameWsType(this.gameCode, 'score.update'),
      ts: this.now(),
      payload: { playerId: score.playerId, scoreboard: score.scoreboard },
      roomId,
    })
  }
}
