import type {
  DiceHoldPayload,
  DiceRollPayload,
  RoundState,
  RoundSubmitPayload,
  TurnAdvanceInput,
} from '../round/index.js'
import type {
  YachtBroadcaster,
  YachtRoundService,
  YachtRoundTimer,
  YachtScoreSubmission,
} from './yachtPorts.js'
import { yachtWsType } from './yachtWsTypes.js'

export interface YachtTurnActionServiceDeps {
  readonly rounds: YachtRoundService
  readonly timers: YachtRoundTimer
  readonly broadcaster: YachtBroadcaster
  readonly submissions: YachtScoreSubmission
}

export interface YachtTurnActionServiceOptions {
  /** 봉투 `ts`의 출처. Java는 `WsEnvelope.of`가 `System.currentTimeMillis()`를 쓴다. */
  readonly now?: () => number
}

/**
 * 사람의 WS 요청과 서버가 제어하는 봇(3.2)이 **공유하는** 야추 행동 경계.
 *
 * 호출자는 "누가 무엇을 하려는지"만 넘기고, 상태 변경 뒤의 방송·타이머 진행은
 * 여기가 한 벌로 처리한다. 이 경계가 있어야 봇이 사람과 **완전히 같은 경로**를 타고,
 * "봇만 점수가 안 들어간다" 같은 갈라짐이 생기지 않는다.
 */
export class YachtTurnActionService {
  private readonly rounds: YachtRoundService
  private readonly timers: YachtRoundTimer
  private readonly broadcaster: YachtBroadcaster
  private readonly submissions: YachtScoreSubmission
  private readonly now: () => number

  constructor(deps: YachtTurnActionServiceDeps, options: YachtTurnActionServiceOptions = {}) {
    this.rounds = deps.rounds
    this.timers = deps.timers
    this.broadcaster = deps.broadcaster
    this.submissions = deps.submissions
    this.now = options.now ?? Date.now
  }

  /**
   * 굴림 하나. **주사위는 서버가 만든다**(DESIGN.md 원칙 1) — payload에는 의도
   * (rollCount·held)만 있고 눈은 없다.
   *
   * 방송의 `held`는 **클라이언트가 보낸 값의 에코**다(서버 상태가 아니다). 굴린
   * 사람의 화면은 자기가 보낸 킵으로 이미 애니메이션을 시작했으므로, 서버 상태를
   * 실어 보내면 같은 값이어도 프레임이 어긋난다. 마감 자동 굴림(`RoundTimeoutResolver`)만
   * 서버 `activeHeld`를 쓰고 `auto: true`를 붙인다 — 이 **비대칭이 계약**이다
   * (docs/design/games/yacht.md).
   *
   * 굴림마다 타이머를 다시 건다 = `round.start`가 같은 턴에서도 재전송된다(마감 연장).
   */
  async roll(
    roomId: string,
    actorId: string,
    payload: DiceRollPayload,
    requestMsgId: string | null,
  ): Promise<RoundState> {
    const state = await this.rounds.recordRoll(roomId, actorId, payload)
    this.broadcaster.broadcast(roomId, {
      type: yachtWsType('dice.broadcast'),
      ts: this.now(),
      payload: {
        playerId: actorId,
        roundNumber: state.roundNumber,
        rollCount: state.activeRollCount,
        dice: [...(state.activeDice ?? [])],
        held: [...payload.held],
        auto: false,
      },
      roomId,
      // 자기 msgId가 돌아오면 프론트가 "내 굴림" 물리 애니메이션 모드를 켠다.
      msgId: requestMsgId ?? undefined,
    })
    await this.timers.start(roomId, state)
    return state
  }

  /**
   * 굴림 사이의 킵 변경. **타이머를 다시 걸지 않는다** — 킵 토글로 턴을 무한히 늘릴 수
   * 없어야 한다. 방송 타입이 `dice.broadcast`와 분리된 이유는 클라이언트가 그 타입에서
   * 굴림 애니메이션을 트리거하기 때문이다(킵만 바뀐 판에 쓰면 주사위가 다시 굴러간다).
   */
  async hold(
    roomId: string,
    actorId: string,
    payload: DiceHoldPayload,
    requestMsgId: string | null,
  ): Promise<RoundState> {
    const state = await this.rounds.recordHold(roomId, actorId, payload)
    this.broadcaster.broadcast(roomId, {
      type: yachtWsType('dice.hold_changed'),
      ts: this.now(),
      payload: {
        playerId: actorId,
        roundNumber: state.roundNumber,
        // 굴림과 달리 **서버 상태**를 싣는다. 굴림 애니메이션이
        // 없으므로 프레임 어긋남 문제가 없고, 관전자가 권위 값을 보는 쪽이 낫다.
        held: [...(state.activeHeld ?? [])],
      },
      roomId,
      msgId: requestMsgId ?? undefined,
    })
    return state
  }

  /**
   * 점수 확정 + 턴 진행. 방송(score.update → round.end → round.start)과 게임 종료
   * 판정은 전부 `advanceTurn` 한 곳에 있다 — 마감 만료 경로와 같은 코드를 지나야
   * 두 경로가 갈라지지 않는다.
   */
  async submitScore(
    roomId: string,
    actorId: string,
    payload: RoundSubmitPayload,
    requestMsgId: string | null,
  ): Promise<TurnAdvanceInput> {
    const result = await this.submissions.submit(roomId, actorId, payload)
    await this.timers.advanceTurn(roomId, result, requestMsgId)
    return result
  }
}
