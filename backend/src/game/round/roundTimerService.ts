import { YACHT_DICE } from '../catalog.js'
import { gameWsType } from '../module.js'
import type { RoundDeadlineScheduler } from './deadlineScheduler.js'
import type {
  ConfirmedScore,
  GameCompletionPort,
  RoundBroadcaster,
  RoundPresence,
  RoundRoomService,
  ScoreRoundSubmissionOutcome,
} from './roundPorts.js'
import type { RoundState, RoundSubmissionResult } from './roundState.js'
import type { RoundSynchronizationService } from './roundSynchronizationService.js'
import type { RoundTimeoutResolverPort } from './roundTimeoutResolver.js'

/** 한 턴에 주어지는 시간. 클라이언트에는 이 마감 시각을 그대로 알린다. */
export const ROUND_DURATION_MS = 25_000

/**
 * 강제 진행을 마감 시각보다 이만큼 늦춘다.
 *
 * 마감 처리 자체는 서버가 한다(`RoundTimeoutResolver`). 다만 플레이어가 마감 직전에
 * 누른 round.submit이 아직 날아오는 중일 수 있고, 그 요청이 NOT_YOUR_TURN으로
 * 거절되면 본인이 고른 족보 대신 서버가 고른 족보가 기록된다. 왕복 시간과 클라
 * 시계 오차를 흡수할 만큼만 준다.
 */
export const EXPIRY_GRACE_MS = 1_000

/** 오프라인 상태로 자기 턴을 이 횟수째 맞으면 스킵 대신 자동 퇴장시킨다. */
const MAX_OFFLINE_TURNS = 2

/** 봇 오케스트레이터(3.2)가 구독하는 턴 시작 알림 — Java `RoundStartedEvent`. */
export interface RoundStartedEvent {
  readonly roomId: string
  readonly state: RoundState
}

/** 타이머가 `advanceTurn`으로 받는 것. 타임아웃 경로는 `score: null`로 들어온다. */
export type TurnAdvanceInput = ScoreRoundSubmissionOutcome<RoundSubmissionResult>

export interface RoundTimerServiceDeps {
  readonly timeoutResolver: RoundTimeoutResolverPort
  readonly deadlineScheduler: RoundDeadlineScheduler
  readonly broadcaster: RoundBroadcaster
  readonly gameCompletion: GameCompletionPort
  readonly synchronizationService: RoundSynchronizationService
  readonly presence: RoundPresence
  readonly roomService: RoundRoomService
}

export interface RoundTimerServiceOptions {
  readonly now?: () => number
  readonly gameCode?: string
  /** Java `ApplicationEventPublisher.publishEvent(RoundStartedEvent)` 자리. */
  readonly onRoundStarted?: (event: RoundStartedEvent) => void
  /** 종료 전이 실패처럼 "진행은 멈추지만 예외는 아닌" 상황의 관측 훅(Java `log.warn`). */
  readonly onWarning?: (roomId: string, reason: string) => void
}

interface ActiveDeadline {
  readonly roundNumber: number
  /** epoch ms. Java는 `Instant`. */
  readonly deadline: number
}

/**
 * 야추 턴 시계 — backend-java `RoundTimerService`.
 *
 * **Node 이식에서 가장 큰 차이: 전 경로가 async다.** Java는 `roomService`가 동기라
 * `start`가 `Instant`를 그냥 돌려줬지만, 우리 `RoomService.getSnapshot`·`touch`·
 * `leave`는 Redis라 Promise다. 마감 스케줄러의 작업 시그니처가 이미
 * `() => void | Promise<void>`라 그대로 얹힌다(2.3에서 그 이유로 넓혀 뒀다).
 *
 * 방송 순서가 계약이다(`__tests__/roundTimerService.test.ts`가 고정):
 * `score.update` → `round.end` → `round.start`.
 */
export class RoundTimerService {
  private readonly timeoutResolver: RoundTimeoutResolverPort
  private readonly deadlineScheduler: RoundDeadlineScheduler
  private readonly broadcaster: RoundBroadcaster
  private readonly gameCompletion: GameCompletionPort
  private readonly synchronizationService: RoundSynchronizationService
  private readonly presence: RoundPresence
  private readonly roomService: RoundRoomService
  private readonly now: () => number
  private readonly gameCode: string
  private readonly onRoundStarted: (event: RoundStartedEvent) => void
  private readonly onWarning: (roomId: string, reason: string) => void

  private readonly activeDeadlines = new Map<string, ActiveDeadline>()
  /** roomId → (playerId → 오프라인으로 맞은 자기 턴 수). 재접속하면 지운다. */
  private readonly offlineMisses = new Map<string, Map<string, number>>()

  constructor(deps: RoundTimerServiceDeps, options: RoundTimerServiceOptions = {}) {
    this.timeoutResolver = deps.timeoutResolver
    this.deadlineScheduler = deps.deadlineScheduler
    this.broadcaster = deps.broadcaster
    this.gameCompletion = deps.gameCompletion
    this.synchronizationService = deps.synchronizationService
    this.presence = deps.presence
    this.roomService = deps.roomService
    this.now = options.now ?? Date.now
    this.gameCode = options.gameCode ?? YACHT_DICE
    this.onRoundStarted = options.onRoundStarted ?? (() => {})
    this.onWarning = options.onWarning ?? (() => {})
  }

  /**
   * 이 턴의 마감 타이머를 걸고 방에 round.start를 알린다. 턴 순서를 함께 실어
   * 클라가 명단 정렬로 순서를 추측하지 않게 한다.
   *
   * 턴 주인이 오프라인이면 타이머를 걸지 않고 즉시 진행한다: 첫 오프라인 턴은 점수
   * 없이 스킵, {@link MAX_OFFLINE_TURNS}번째 턴은 자동 퇴장. 스킵/퇴장 후의 다음
   * 턴은 `advanceTurn`을 거쳐 다시 여기로 돌아오므로 연속 오프라인 플레이어도
   * 연쇄적으로 처리된다.
   *
   * @returns 걸린 마감 시각(epoch ms). 오프라인 스킵·퇴장으로 타이머를 걸지 않았으면 null.
   */
  async start(roomId: string, state: RoundState): Promise<number | null> {
    if (await this.isOffline(roomId, state.activePlayerId)) {
      await this.handleOfflineTurn(roomId, state)
      return null
    }
    // 턴이 시작될 때마다 방 수명을 다시 센다. 이게 없으면 TTL이 "생성 후 40분"이라,
    // 한 판이 그보다 길어지는 순간(6인 × 12라운드면 충분히 가능) 플레이 중인 방이 사라진다.
    await this.roomService.touch(roomId)

    const deadline = this.now() + ROUND_DURATION_MS
    const roundNumber = state.roundNumber
    const activePlayerId = state.activePlayerId
    this.activeDeadlines.set(roomId, { roundNumber, deadline })
    // 클라에는 마감 시각을 그대로 알리고, 강제 진행만 EXPIRY_GRACE_MS 뒤로 미룬다.
    this.deadlineScheduler.schedule(roomId, roundNumber, deadline + EXPIRY_GRACE_MS, () =>
      this.expireTurn(roomId, roundNumber, activePlayerId),
    )
    this.broadcaster.broadcast(roomId, {
      type: gameWsType(this.gameCode, 'round.start'),
      ts: this.now(),
      payload: {
        roundNumber,
        deadline,
        activePlayerId,
        turnOrder: [...state.participantOrder],
      },
      roomId,
    })
    this.onRoundStarted({ roomId, state })
    return deadline
  }

  cancel(roomId: string, roundNumber: number): void {
    this.deadlineScheduler.cancel(roomId, roundNumber)
    const active = this.activeDeadlines.get(roomId)
    if (active !== undefined && active.roundNumber === roundNumber) {
      this.activeDeadlines.delete(roomId)
    }
  }

  cancelRoom(roomId: string): void {
    this.deadlineScheduler.cancelRoom(roomId)
    this.activeDeadlines.delete(roomId)
    this.offlineMisses.delete(roomId)
  }

  /** 재접속 복귀 시 호출 — 오프라인 결석 횟수를 처음부터 다시 센다. */
  clearOfflineMisses(roomId: string, playerId: string): void {
    const misses = this.offlineMisses.get(roomId)
    if (misses === undefined) return
    misses.delete(playerId)
    if (misses.size === 0) this.offlineMisses.delete(roomId)
  }

  /** 재접속 스냅샷(2.8)이 현재 턴의 서버 마감 시각을 그대로 복원할 때 쓴다. */
  currentDeadline(roomId: string): number | undefined {
    return this.activeDeadlines.get(roomId)?.deadline
  }

  /**
   * 턴이 끝난 뒤의 공통 진행 경로. **"다음 턴을 시작할지 게임을 끝낼지"의 판단은
   * 여기 한 곳에만 있다.** 제출(WS 핸들러)과 마감 만료(타이머)가 같은 코드를 지나야
   * 두 경로가 갈라지지 않는다.
   *
   * @param requestMsgId 클라이언트 제출이면 그 msgId — 클라는 이 값으로 자기 제출의
   *   확정을 판별한다. 마감 처리로 들어온 경우엔 점수 방송을 `RoundTimeoutResolver`가
   *   이미 했으므로 score가 null이고 msgId도 없다.
   */
  async advanceTurn(
    roomId: string,
    result: TurnAdvanceInput,
    requestMsgId: string | null = null,
  ): Promise<void> {
    const round = result.round
    const completion = round.completedRound
    const endedRoundNumber = completion === null ? round.state.roundNumber : completion.roundNumber

    // 이전 턴 타이머를 가장 먼저 끊는다. 뒤로 밀면 그 사이 만료가 발화해 턴이 두 번 넘어갈 수 있다.
    this.cancel(roomId, endedRoundNumber)

    if (result.score !== null) {
      this.broadcastScoreUpdate(roomId, result.score, requestMsgId)
    }

    if (completion !== null) {
      this.broadcaster.broadcast(roomId, {
        type: gameWsType(this.gameCode, 'round.end'),
        ts: this.now(),
        payload: {
          roundNumber: completion.roundNumber,
          submitted: [...completion.submittedPlayerIds],
        },
        roomId,
      })
      // 종료 판정은 저장소(전원 점수판 완료)에 맡기고, 라운드 상한에 닿았으면 강제 종료한다.
      if (await this.gameCompletion.finishIfComplete(roomId, completion.gameCompleted)) {
        return
      }
    }

    if (round.state.finished) {
      // 라운드 상한에 닿았는데 종료 전이가 실패한 경우(방·게임 정보 유실 등).
      // 타이머를 다시 걸면 끝난 게임이 계속 돌아가므로 여기서 멈춘다.
      this.onWarning(roomId, 'round_cap_reached_without_finish')
      return
    }
    await this.start(roomId, round.state)
  }

  /**
   * 게임 중 이탈 확정의 단일 경로 — 명시적 나가기(REST·WS room.leave)와 오프라인
   * {@link MAX_OFFLINE_TURNS}턴 자동 퇴장이 전부 여기로 모인다.
   *
   * 명단(레지스트리·Redis) 제거 → `room.player_left` 방송 → 턴 순서 제거 순으로
   * 정리한다. 이미 빠진 플레이어에게는 방송하지 않는다(멱등) — REST 나가기와 소켓
   * 종료가 연달아 도착해도 안전하다.
   */
  async removePlayer(roomId: string, playerId: string): Promise<void> {
    this.clearOfflineMisses(roomId, playerId)
    const removed = this.presence.removePlayer(roomId, playerId)
    await this.roomService.leave(roomId, playerId)
    if (removed !== null) {
      this.broadcaster.broadcast(roomId, {
        // 방 이벤트는 게임 네임스페이스가 붙지 않는다(Java `WsEnvelope.of("room.player_left")`).
        type: 'room.player_left',
        ts: this.now(),
        payload: { playerId },
        roomId,
      })
    }

    const state = await this.synchronizationService.findByRoomId(roomId)
    if (state === undefined || state.finished || !state.participantIds.has(playerId)) {
      return
    }
    if (state.participantOrder.length === 1) {
      // 마지막 참가자까지 나갔다 — 이어갈 턴이 없으니 라운드 상태와 타이머를 통째로 버린다.
      this.cancelRoom(roomId)
      await this.synchronizationService.remove(roomId)
      return
    }
    if (state.activePlayerId === playerId) {
      // 진행 중인 자기 턴은 만료 경로로 넘겨 라운드 완료·게임 종료 판정을 한 곳에 유지한다.
      const expired = await this.synchronizationService.expire(roomId, state.roundNumber, playerId)
      const updated = await this.synchronizationService.removeParticipant(roomId, playerId)
      if (expired !== undefined && updated !== undefined) {
        await this.advanceTurn(roomId, {
          score: null,
          round: { state: updated, completedRound: expired.completedRound },
        })
      }
      return
    }
    await this.synchronizationService.removeParticipant(roomId, playerId)
  }

  private async expireTurn(
    roomId: string,
    roundNumber: number,
    activePlayerId: string,
  ): Promise<void> {
    const resolution = await this.timeoutResolver.resolve(roomId, roundNumber, activePlayerId)
    switch (resolution.kind) {
      // 서버가 대신 굴렸을 뿐 턴 주인은 그대로다. 같은 턴에 남은 굴림을 쓸 시간을 다시 준다.
      case 'AUTO_ROLLED':
        await this.start(roomId, resolution.rolled)
        return
      // 점수 방송은 resolver가 이미 했다. 여기서는 라운드 종료·게임 종료·다음 턴만 판단한다.
      case 'ADVANCED':
        await this.advanceTurn(roomId, { score: null, round: resolution.advanced })
        return
      case 'STALE':
        // 플레이어가 직접 제출해 이미 턴이 넘어갔다. 그쪽 경로가 타이머를 다시 걸었다.
        return
    }
  }

  /** 명단에 없는 플레이어(비정상 상태)도 오프라인으로 본다 — 연결이 없다는 사실은 같다. */
  private async isOffline(roomId: string, playerId: string): Promise<boolean> {
    const room = await this.roomService.getSnapshot(roomId)
    const serverControlled =
      room?.players.some((player) => player.playerId === playerId && player.kind === 'BOT') ?? false
    // 봇은 소켓이 없다 — 명단으로 판정하면 매 턴 오프라인 스킵되어 봇이 플레이할 수 없다.
    if (serverControlled) return false
    const member = this.presence.find(roomId, playerId)
    return member === null || member.status === 'offline'
  }

  private async handleOfflineTurn(roomId: string, state: RoundState): Promise<void> {
    const playerId = state.activePlayerId
    let misses = this.offlineMisses.get(roomId)
    if (misses === undefined) {
      misses = new Map()
      this.offlineMisses.set(roomId, misses)
    }
    const count = (misses.get(playerId) ?? 0) + 1
    misses.set(playerId, count)

    if (count >= MAX_OFFLINE_TURNS) {
      await this.removePlayer(roomId, playerId)
      return
    }
    const expired = await this.synchronizationService.expire(roomId, state.roundNumber, playerId)
    if (expired !== undefined) {
      await this.advanceTurn(roomId, { score: null, round: expired })
    }
  }

  private broadcastScoreUpdate(
    roomId: string,
    score: ConfirmedScore,
    requestMsgId: string | null,
  ): void {
    this.broadcaster.broadcast(roomId, {
      type: gameWsType(this.gameCode, 'score.update'),
      ts: this.now(),
      payload: { playerId: score.playerId, scoreboard: score.scoreboard },
      roomId,
      // null이면 필드를 생략한다(Java `@JsonInclude(NON_NULL)`).
      msgId: requestMsgId ?? undefined,
    })
  }
}
