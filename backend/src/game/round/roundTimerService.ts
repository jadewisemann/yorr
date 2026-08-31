import { YACHT_DICE } from '../catalog.js'
import { gameWsType } from '../module.js'
import type { RoundDeadlineScheduler } from './deadlineScheduler.js'
import type { RoundDeadlineStore } from './deadlineStore.js'
import type {
  ConfirmedScore,
  GameCompletionPort,
  RoundBroadcaster,
  RoundPresence,
  RoundRoomService,
  RoundRoomSnapshot,
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
export const MAX_OFFLINE_TURNS = 2

/**
 * 사람이 이 수 이하인 방은 **시계를 걸지 않는다**(연습 방).
 *
 * 턴 제한의 목적은 한 사람이 멈춰 있을 때 나머지가 무한정 기다리지 않게 하는 것이다.
 * 봇만 데리고 혼자 하는 방에는 기다리는 사람이 없으므로 그 목적이 사라진다 —
 * 25초는 족보를 따져 보는 사람에게 재촉이기만 하다. 봇은 자기 턴을 스스로 진행하므로
 * (`BotTurnOrchestrator`) 시계 없이도 판이 앞으로 간다.
 *
 * 여기 걸리면 `round.start`의 `deadline`이 **null로 나간다** — 프론트는 그때 타이머를
 * 그리지 않는다(`frontend/src/realtime/wsEvents.ts`의 `RoundStartPayload`).
 */
export const UNTIMED_HUMAN_LIMIT = 1

/** 봇 오케스트레이터(3.2)가 구독하는 턴 시작 알림. */
export interface RoundStartedEvent {
  readonly roomId: string
  readonly state: RoundState
}

/** 타이머가 `advanceTurn`으로 받는 것. 타임아웃 경로는 `score: null`로 들어온다. */
export type TurnAdvanceInput = ScoreRoundSubmissionOutcome<RoundSubmissionResult>

export interface RoundTimerServiceDeps {
  readonly timeoutResolver: RoundTimeoutResolverPort
  readonly deadlineScheduler: RoundDeadlineScheduler
  /**
   * 마감 시각의 **영속 사본**(PR 6). 예약기가 인메모리인 것은 그대로다 —
   * 여기 저장되는 것은 "언제 마감인가"라는 데이터이고, 발화 책임은 여전히 이
   * 프로세스에 있다(DESIGN.md 원칙 8).
   *
   * ⚠️ 운영은 `RedisRoundDeadlineStore`다. `InMemoryRoundDeadlineStore`를 넣어도
   * 타입이 맞고 테스트가 전부 통과하지만, 그 순간 재시작마다 진행 중 게임이 사라지는
   * 예전 동작으로 조용히 돌아간다.
   */
  readonly deadlineStore: RoundDeadlineStore
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
  /** 종료 전이 실패처럼 "진행은 멈추지만 예외는 아닌" 상황의 관측 훅. */
  readonly onWarning?: (roomId: string, reason: string) => void
}

interface ActiveDeadline {
  readonly roundNumber: number
  /** epoch ms. Java는 `Instant`. 시계를 걸지 않은 턴(연습 방)은 null이다. */
  readonly deadline: number | null
}

/**
 * 야추 턴 시계.
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
  private readonly deadlineStore: RoundDeadlineStore
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
    this.deadlineStore = deps.deadlineStore
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
   * @returns 걸린 마감 시각(epoch ms). 오프라인 스킵·퇴장으로 턴을 시작하지 않았거나,
   * 시계 없는 연습 방({@link UNTIMED_HUMAN_LIMIT})이면 null.
   */
  async start(roomId: string, state: RoundState): Promise<number | null> {
    return this.beginTurn(roomId, state, null)
  }

  /**
   * 재시작 후 **저장된 마감으로** 이 턴을 이어간다(PR 6).
   *
   * `start`와 갈라 두는 것이 요점이다. `start`는 새 턴에 새 시간을 주는 것이 맞고
   * (턴 전이·일시정지 후 재개), 부팅 재무장은 **원래 마감을 그대로** 되살려야 한다.
   * 둘을 합쳐 저장된 마감을 쓰게 하면 "모두 접속을 끊어 시계를 멈춘 뒤 돌아온" 방의
   * 턴이 복귀하는 순간 만료된다 — 일시정지의 뜻이 사라진다.
   *
   * 세 갈래가 전부 여기서 결정된다:
   * - **미래** → 그 시각으로 재무장한다.
   * - **이미 지남** → 예약기가 지연을 0으로 깎아 즉시 발화하므로(`schedule` 주석)
   * 별도 분기가 없다. 턴은 서버 대리 진행으로 넘어간다.
   * - **유효하지 않음**(기록이 없거나 라운드 번호가 어긋남) → `false`. 호출자가 그 방을
   * fail-closed로 닫는다. 반쯤 살아 있는 방을 남기면 상태는 살아 있는데 턴이 넘어가지
   * 않고 JOIN도 `game_started`로 막히는 최악의 상태가 된다.
   *
   * @returns 재무장했으면 true.
   */
  async resumeFromStored(roomId: string, state: RoundState): Promise<boolean> {
    const stored = await this.deadlineStore.find(roomId)
    if (stored === undefined || stored.roundNumber !== state.roundNumber) return false
    await this.beginTurn(roomId, state, { deadline: stored.deadline })
    return true
  }

  /**
   * `start`와 `resumeFromStored`의 공통 경로.
   *
   * @param restored 저장된 마감으로 되살리는 경우 그 값. `null`이면 지금 새로 계산한다.
   */
  private async beginTurn(
    roomId: string,
    state: RoundState,
    restored: { readonly deadline: number | null } | null,
  ): Promise<number | null> {
    // 방 스냅샷을 한 번만 읽어 오프라인 판정과 연습 방 판정에 함께 쓴다(둘 다 명단이 근거다).
    const room = await this.roomService.getSnapshot(roomId)
    /*
     * **되살리는 경로에서는 오프라인 판정을 하지 않는다.**
     *
     * 부팅 시점에는 아직 아무 소켓도 붙지 않았으므로 레지스트리가 전원을 오프라인으로
     * 답한다. 그 판정을 그대로 태우면 재무장이 곧 턴 스킵이 되고, 두 턴이면
     * {@link MAX_OFFLINE_TURNS}에 걸려 **재시작만으로 사람이 방에서 쫓겨난다.**
     * 그것은 이 기능이 없애려던 문제(재시작이 판을 끊는다)를 형태만 바꿔 되살리는 것이다.
     *
     * 정말로 돌아오지 않는 사람은 어차피 걸러진다: 되살린 마감이 발화하면 평소의 만료
     * 경로가 돌고, 그 다음 턴은 `start`를 지나므로 그때 오프라인 판정을 받는다.
     */
    if (restored === null && this.isOffline(room, roomId, state.activePlayerId)) {
      await this.handleOfflineTurn(roomId, state)
      return null
    }
    // 턴이 시작될 때마다 방 수명을 다시 센다. 이게 없으면 TTL이 "생성 후 40분"이라,
    // 한 판이 그보다 길어지는 순간(6인 × 12라운드면 충분히 가능) 플레이 중인 방이 사라진다.
    await this.roomService.touch(roomId)

    const roundNumber = state.roundNumber
    const activePlayerId = state.activePlayerId
    const deadline = restored
      ? restored.deadline
      : isUntimedRoom(room)
        ? null
        : this.now() + ROUND_DURATION_MS
    this.activeDeadlines.set(roomId, { roundNumber, deadline })
    // 되살리는 경우는 이미 저장된 값이므로 다시 쓰지 않는다 — 같은 값을 쓰는 왕복이고,
    // 부팅 때 방 수만큼 불필요한 왕복이 늘어난다.
    if (restored === null) await this.deadlineStore.save(roomId, { roundNumber, deadline })
    /*
     * 예약은 **사람에게 보이는 마감과 별개**다.
     *
     * - 시계가 있는 방: 마감 그대로 예약한다(강제 진행만 EXPIRY_GRACE_MS 뒤로 미룬다).
     * - 연습 방의 사람 턴: 예약하지 않는다. 이게 "제한 시간 없음"의 전부다.
     * - 연습 방의 **봇 턴: 화면에는 시계가 없어도 예약은 남긴다.** 봇 스텝의 예외는
     * 삼켜지고 라운드 타이머가 유일한 폴백이기 때문이다
     * (docs/design/games/yacht.md 「실패 격리」). 이게 없으면 봇 굴림이 한 번
     * 실패한 연습 방은 아무도 깨우지 못해 영원히 멈춘다.
     */
    const expireAt =
      deadline ?? (isBot(room, activePlayerId) ? this.now() + ROUND_DURATION_MS : null)
    if (expireAt !== null) {
      this.deadlineScheduler.schedule(roomId, roundNumber, expireAt + EXPIRY_GRACE_MS, () =>
        this.expireTurn(roomId, roundNumber, activePlayerId),
      )
    }
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

  /** 영속 사본까지 지우므로 async다 — 호출자는 전부 이미 async 문맥이다. */
  async cancel(roomId: string, roundNumber: number): Promise<void> {
    this.deadlineScheduler.cancel(roomId, roundNumber)
    const active = this.activeDeadlines.get(roomId)
    if (active !== undefined && active.roundNumber === roundNumber) {
      this.activeDeadlines.delete(roomId)
    }
    await this.deadlineStore.remove(roomId, roundNumber)
  }

  async cancelRoom(roomId: string): Promise<void> {
    this.deadlineScheduler.cancelRoom(roomId)
    this.activeDeadlines.delete(roomId)
    this.offlineMisses.delete(roomId)
    await this.deadlineStore.removeRoom(roomId)
  }

  /** 재접속 복귀 시 호출 — 오프라인 결석 횟수를 처음부터 다시 센다. */
  clearOfflineMisses(roomId: string, playerId: string): void {
    const misses = this.offlineMisses.get(roomId)
    if (misses === undefined) return
    misses.delete(playerId)
    if (misses.size === 0) this.offlineMisses.delete(roomId)
  }

  /**
   * 재접속 스냅샷(2.8)이 현재 턴의 서버 마감 시각을 그대로 복원할 때 쓴다.
   *
   * **세 값이 다 다른 뜻이다**: 시각이면 그 턴의 마감, `null`이면 시계 없는 턴
   * (연습 방 — {@link UNTIMED_HUMAN_LIMIT}), `undefined`면 진행 중인 턴 자체가 없다.
   */
  currentDeadline(roomId: string): number | null | undefined {
    const active = this.activeDeadlines.get(roomId)
    return active === undefined ? undefined : active.deadline
  }

  /**
   * 턴이 끝난 뒤의 공통 진행 경로. **"다음 턴을 시작할지 게임을 끝낼지"의 판단은
   * 여기 한 곳에만 있다.** 제출(WS 핸들러)과 마감 만료(타이머)가 같은 코드를 지나야
   * 두 경로가 갈라지지 않는다.
   *
   * @param requestMsgId 클라이언트 제출이면 그 msgId — 클라는 이 값으로 자기 제출의
   * 확정을 판별한다. 마감 처리로 들어온 경우엔 점수 방송을 `RoundTimeoutResolver`가
   * 이미 했으므로 score가 null이고 msgId도 없다.
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
    await this.cancel(roomId, endedRoundNumber)

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
        // 방 이벤트는 게임 네임스페이스가 붙지 않는다.
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
      await this.cancelRoom(roomId)
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
  private isOffline(room: RoundRoomSnapshot | null, roomId: string, playerId: string): boolean {
    // 봇은 소켓이 없다 — 명단으로 판정하면 매 턴 오프라인 스킵되어 봇이 플레이할 수 없다.
    if (isBot(room, playerId)) return false
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
      // null이면 필드를 생략한다.
      msgId: requestMsgId ?? undefined,
    })
  }
}

/** 방 명단이 근거다 — 명단에 없으면 봇이 아니다(사람으로 보고 오프라인 판정을 태운다). */
function isBot(room: RoundRoomSnapshot | null, playerId: string): boolean {
  return (
    room?.players.some((player) => player.playerId === playerId && player.kind === 'BOT') ?? false
  )
}

/**
 * 봇을 뺀 사람 수로 판정한다 — 방 스냅샷을 못 읽었으면(비정상) 시계를 건다.
 * 판단이 안 서는 쪽에서는 **기존 동작**으로 떨어지는 것이 안전하다.
 */
function isUntimedRoom(room: RoundRoomSnapshot | null): boolean {
  if (room === null) return false
  const humans = room.players.filter((player) => player.kind !== 'BOT').length
  return humans <= UNTIMED_HUMAN_LIMIT
}
