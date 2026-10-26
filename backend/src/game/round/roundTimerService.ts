import { YACHT_DICE } from '../catalog.js'
import { gameWsType } from '../module.js'
import type { RoundDeadlineScheduler } from './deadlineScheduler.js'
import type { RoundDeadlineStore } from './deadlineStore.js'
import { OfflineTurns } from './roundOfflineTurns.js'
import { removePlayerFromRound } from './roundPlayerRemoval.js'
import type {
  ConfirmedScore,
  GameCompletionPort,
  RoundBroadcaster,
  RoundPresence,
  RoundRoomService,
} from './roundPorts.js'
import type { RoundState } from './roundState.js'
import type { RoundSynchronizationService } from './roundSynchronizationService.js'
import type { RoundTimeoutResolverPort } from './roundTimeoutResolver.js'
import type {
  RoundStartedEvent,
  RoundTimerServiceDeps,
  RoundTimerServiceOptions,
  TurnAdvanceInput,
} from './roundTimerPorts.js'
import { armTurn } from './roundTurnClock.js'

export type {
  RoundStartedEvent,
  RoundTimerServiceDeps,
  RoundTimerServiceOptions,
  TurnAdvanceInput,
} from './roundTimerPorts.js'
// 상수·명단 판정은 roundTiming.ts가 정본이다. 기존 소비자(테스트·봇)가 이 파일에서
// 가져가므로 여기서 re-export한다.
export {
  EXPIRY_GRACE_MS,
  MAX_OFFLINE_TURNS,
  ROUND_DURATION_MS,
  UNTIMED_HUMAN_LIMIT,
} from './roundTiming.js'

interface ActiveDeadline {
  readonly roundNumber: number
  /** epoch ms. 시계를 걸지 않은 턴(연습 방)은 null이다. */
  readonly deadline: number | null
}

/**
 * 야추 턴 시계.
 *
 * **전 경로가 async다.** `RoomService.getSnapshot`·`touch`·`leave`가 Redis라
 * Promise를 돌려주기 때문이다. 마감 스케줄러의 작업 시그니처가
 * `() => void | Promise<void>`로 넓혀져 있어 그대로 얹힌다.
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
  private readonly offlineTurns: OfflineTurns

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
    this.offlineTurns = new OfflineTurns({
      presence: deps.presence,
      synchronizationService: deps.synchronizationService,
      removePlayer: (targetRoomId, targetPlayerId) =>
        this.removePlayer(targetRoomId, targetPlayerId),
      advanceTurn: (targetRoomId, input) => this.advanceTurn(targetRoomId, input),
    })
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
    if (restored === null && this.offlineTurns.isOffline(room, roomId, state.activePlayerId)) {
      await this.offlineTurns.handle(roomId, state)
      return null
    }
    // 턴이 시작될 때마다 방 수명을 다시 센다. 이게 없으면 TTL이 "생성 후 40분"이라,
    // 한 판이 그보다 길어지는 순간(6인 × 12라운드면 충분히 가능) 플레이 중인 방이 사라진다.
    await this.roomService.touch(roomId)

    const deadline = await armTurn(this.clockPorts(), {
      roomId,
      state,
      room,
      restored,
      remember: (targetRoomId, roundNumber, nextDeadline) => {
        this.activeDeadlines.set(targetRoomId, { roundNumber, deadline: nextDeadline })
      },
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
    this.offlineTurns.forgetRoom(roomId)
    await this.deadlineStore.removeRoom(roomId)
  }

  /** 재접속 복귀 시 호출 — 오프라인 결석 횟수를 처음부터 다시 센다. */
  clearOfflineMisses(roomId: string, playerId: string): void {
    this.offlineTurns.clear(roomId, playerId)
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

  async removePlayer(roomId: string, playerId: string): Promise<void> {
    return removePlayerFromRound(
      {
        broadcaster: this.broadcaster,
        now: this.now,
        presence: this.presence,
        roomService: this.roomService,
        synchronizationService: this.synchronizationService,
        advanceTurn: (targetRoomId, input) => this.advanceTurn(targetRoomId, input),
        cancelRoom: (targetRoomId) => this.cancelRoom(targetRoomId),
        clearOfflineMisses: (targetRoomId, targetPlayerId) =>
          this.clearOfflineMisses(targetRoomId, targetPlayerId),
      },
      roomId,
      playerId,
    )
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

  private clockPorts() {
    return {
      deadlineScheduler: this.deadlineScheduler,
      deadlineStore: this.deadlineStore,
      broadcaster: this.broadcaster,
      now: this.now,
      gameCode: this.gameCode,
      onExpire: (roomId: string, roundNumber: number, activePlayerId: string) =>
        this.expireTurn(roomId, roundNumber, activePlayerId),
    }
  }
}
