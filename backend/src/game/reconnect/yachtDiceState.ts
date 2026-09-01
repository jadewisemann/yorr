import type { ReconnectRoundState, ScoreboardsByPlayer } from './reconnectPorts.js'

/**
 * 재접속 시 클라이언트가 진행 화면을 복원하는 데 필요한 권위 상태.
 *
 * 정본은 프론트의 `GameState`(`frontend/src/realtime/wsEvents.ts`)이며
 * `sys.reconnected`/`state.sync` 스냅샷의 `game` 필드에 그대로 실린다.
 *
 * **왜 `game/yacht/`가 아니라 여기 있는가**: 이 타입을 만드는 유일한 곳이 재접속
 * 스냅샷이고, 야추 모듈(3.1)은 이걸 **소비**만 한다. 3.1이 자기 쪽에서 다시
 * 선언하면 와이어 모양이 두 곳으로 갈라진다 — 필요하면 `game/yacht/`에서
 * 재수출한다.
 */
export interface YachtDiceState {
  readonly roundNumber: number
  readonly activePlayerId: string
  /**
   * 현재 턴 마감 시각(epoch ms). 서버 시계가 권위다.
   * 시계를 걸지 않은 턴(봇만 있는 연습 방)은 **null** — 프론트가 타이머를 그리지 않는다.
   */
  readonly roundDeadline: number | null
  /** playerId → 점수판. 내용은 점수 계층이 만든 것을 그대로 통과시킨다. */
  readonly scores: Readonly<Record<string, unknown>>
  readonly turnOrder: readonly string[]
  /** 현재 턴에서 이미 굴린 횟수(0~3). 첫 굴림 전이면 0. */
  readonly rollCount: number
  /** 첫 굴림 전에는 **생략**된다. */
  readonly dice?: readonly number[] | undefined
  /** 첫 굴림 전에는 **생략**된다. */
  readonly held?: readonly boolean[] | undefined
}

/**
 * 라운드 상태 + 마감 + 점수판을 재접속용 게임 상태로 조립한다.
 *
 * `dice`·`held`는 null 대신 **undefined**로 둔다: `JSON.stringify`가 undefined
 * 프로퍼티를 지우므로 "null이면 필드 생략"이라는 와이어 계약이 지켜지고,
 * null을 그대로 실으면 프론트가 "굴렸는데 값이 없다"로 읽는다.
 */
export const createYachtDiceState = (
  round: ReconnectRoundState,
  roundDeadline: number | null,
  scores: ScoreboardsByPlayer,
): YachtDiceState => ({
  roundNumber: round.roundNumber,
  activePlayerId: round.activePlayerId,
  roundDeadline,
  scores: toScoresObject(scores),
  turnOrder: round.participantOrder,
  // 굴림 진행까지 실어야 재접속한 클라이언트가 이어서 굴릴 수 있다.
  rollCount: round.activeRollCount,
  dice: round.activeDice ?? undefined,
  held: round.activeHeld ?? undefined,
})

/**
 * `Map` → 평범한 객체. **`JSON.stringify(new Map())`은 `{}`다** — 조회 계층이
 * 돌려주는 `ReadonlyMap`을 그대로 실으면 점수판이 통째로 사라진다.
 *
 * 삽입 순서(=조회 계층이 정한 playerId 오름차순)가 그대로 객체 키 순서가 된다
 * (`http/routes/gameQueries.ts`의 같은 변환과 같은 근거).
 */
const toScoresObject = (scores: ScoreboardsByPlayer): Readonly<Record<string, unknown>> => {
  // `ReadonlyMap`은 `Map`의 상위 타입이라 instanceof로 좁혀지지 않는다 — 런타임
  // 판정이 끝난 뒤의 단언이다(둘 중 하나뿐인 유니온).
  if (!(scores instanceof Map)) return scores as Readonly<Record<string, unknown>>
  const byPlayer: Record<string, unknown> = {}
  for (const [playerId, scoreboard] of scores) byPlayer[playerId] = scoreboard
  return byPlayer
}
