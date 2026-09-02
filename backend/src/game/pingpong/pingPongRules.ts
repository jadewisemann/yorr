import { DomainError } from '../../errors.js'
import type {
  PingPongBall,
  PingPongDirection,
  PingPongEvent,
  PingPongEventType,
  PingPongFault,
  PingPongPhase,
  PingPongPlayerNumbers,
  PingPongState,
} from './pingPongState.js'
import { isPingPongFinished } from './pingPongState.js'

/**
 * 탁구 규칙. **순수 함수만** 있다:
 * Redis·WS·시계·난수를 모르고, 시각과 좌우 목표점은 인자로 받는다.
 *
 * 궤적은 1차원 해석 모델이다(틱 없음). `pos`는 0→1로 `playerOrder[0]` 쪽을
 * 향하고 `direction=+1`이 "0번에게 오는 중"이다. 현재 위치는
 * `pos + direction × speed × 경과초` 하나로 언제든 복원된다 — 그래서 서버가
 * 프레임을 보내지 않아도 클라이언트가 같은 공을 그린다(DESIGN.md 원칙 2).
 *
 * 좌우(x)는 `x0 → x1` 선형 보간이고 진행률 0.5가 네트 통과 지점이다.
 */

export const NORMAL_SPEED = 1.0
const SMASH_SPEED = 1.95
const WEAK_SPEED = 0.82
export const WIN_SCORE = 11
/** 득점 후·전원 ready 후 다음 서브까지의 시간. */
export const POINT_COUNTDOWN_MILLIS = 2_600
/** 스윙을 과거로 되감을 수 있는 최대 폭 ({@link judgedAt} 참고). */
const MAX_ROLLBACK_MILLIS = 120

/* ── 판정 창 (player 0 기준. player 1은 `1 - v` 미러) ───────────────────── */

/** 이상점 — 여기서 정확히 치면 스매시다. */
const IDEAL_1 = 0.9
const WINDOW_1_LOW = 0.72
const WINDOW_1_HIGH = 1.06
/** 여기까지 오면 놓친 것으로 마감된다(라켓 뒤). */
const MISS_1 = 1.1
const IDEAL_2 = 1 - IDEAL_1
const WINDOW_2_LOW = 1 - WINDOW_1_HIGH
const WINDOW_2_HIGH = 1 - WINDOW_1_LOW
const MISS_2 = 1 - MISS_1
const PERFECT_DISTANCE = 0.06
const GOOD_DISTANCE = 0.1
/** 창 끝에서 이만큼은 폴트 — 창 안이라도 이상점에서 멀면 OUT/NET이다. */
const FAULT_BAND = 0.04
const EARLY_MARGIN = IDEAL_1 - WINDOW_1_LOW
const LATE_MARGIN = WINDOW_1_HIGH - IDEAL_1

/**
 * 판정 창의 좌표 묶음. 규칙 검사가 **경계를 정확히 짚을 수 있도록** 공개한다 —
 * 숫자를 검사에 다시 적으면 값이 바뀐 날 검사가 조용히 다른 것을 재게 된다.
 */
export const PING_PONG_WINDOWS = {
  /** 이상점에서 이만큼까지는 이르게 쳐도 폴트가 아니다. */
  earlyLimit: EARLY_MARGIN - FAULT_BAND,
  faultBand: FAULT_BAND,
  /** 늦은 쪽의 같은 여유. 창이 이상점을 가운데 두지 않으므로 값이 다르다. */
  lateLimit: LATE_MARGIN - FAULT_BAND,
  goodDistance: GOOD_DISTANCE,
  ideal1: IDEAL_1,
  ideal2: IDEAL_2,
  miss1: MISS_1,
  miss2: MISS_2,
  perfectDistance: PERFECT_DISTANCE,
  smashSpeed: SMASH_SPEED,
  weakSpeed: WEAK_SPEED,
  window1High: WINDOW_1_HIGH,
  window1Low: WINDOW_1_LOW,
  window2High: WINDOW_2_HIGH,
  window2Low: WINDOW_2_LOW,
} as const

/** playerOrder 안의 좌석. 없으면 -1. */
const seatOf = (state: PingPongState, playerId: string): number =>
  state.playerOrder.indexOf(playerId)

const lastSeqOf = (sequences: PingPongPlayerNumbers, playerId: string): number =>
  sequences[playerId] ?? -1

const event = (
  version: number,
  type: PingPongEventType,
  playerId: string,
  now: number,
): PingPongEvent => ({ id: version, type, playerId, at: now })

/**
 * 진행률 — direction에 따라 pos를 0→1로 정규화한다.
 *
 * 아래 `direction > 0` 비교들은 `>= 0`으로 바꿔도 같다. `PingPongDirection`이
 * `1 | -1`이라 0이 없기 때문이며, 그 자리마다 사유를 따로 적지 않고 여기 모은다.
 */
// Stryker disable EqualityOperator
const progress = (pos: number, direction: PingPongDirection): number =>
  direction > 0 ? pos : 1 - pos
// Stryker restore EqualityOperator

/** `from → to`를 speed로 지나는 데 걸리는 시간(ms). 최소 1ms. */
const duration = (from: number, to: number, speed: number): number =>
  Math.max(1, Math.round((Math.abs(to - from) / speed) * 1_000))

/** 서브한 공을 아무도 치지 않았을 때의 실점 시각. */
const missDeadline = (ball: PingPongBall, now: number): number =>
  // Stryker disable next-line EqualityOperator: direction은 ±1뿐이다.
  now + duration(ball.pos, ball.direction > 0 ? MISS_1 : MISS_2, ball.speed)

/**
 * 리턴한 공의 마감 시각. 폴트 공은 상대 라켓까지 가지 않는다 — NET은 네트
 * (진행률 0.5)에서, OUT은 테이블 밖(±0.5)에서 죽는다.
 */
const flightDeadline = (ball: PingPongBall, now: number): number => {
  let target: number
  // Stryker disable EqualityOperator
  if (ball.fault === 'NET') target = 0.5
  else if (ball.fault === 'OUT') target = ball.direction > 0 ? 1.5 : -0.5
  else target = ball.direction > 0 ? MISS_1 : MISS_2
  // Stryker restore EqualityOperator
  return now + duration(ball.pos, target, ball.speed)
}

/**
 * `now` 시점으로 공을 전진시킨다. 궤적이 같으므로 `pos`·`launchedAt`만 옮기는
 * 재표현이고 상태 변화가 아니다.
 */
const ballAt = (ball: PingPongBall, now: number): PingPongBall => {
  const elapsed = Math.max(0, now - ball.launchedAt) / 1_000
  return { ...ball, pos: ball.pos + ball.direction * ball.speed * elapsed, launchedAt: now }
}

/** 현재 좌우 위치 — `x0 → x1` 보간을 진행률로 잘라낸다. */
const ballX = (ball: PingPongBall): number => {
  const p = progress(ball.pos, ball.direction)
  return ball.x0 + (ball.x1 - ball.x0) * Math.max(0, Math.min(1, p))
}

/**
 * 창 안이지만 이상점에서 먼 스윙의 폴트 판정. 이르면 OUT, 늦으면 NET이다
 * (일찍 치면 라켓 각이 서서 넘어가고, 늦으면 눌려서 네트에 걸린다).
 */
export const faultOf = (distance: number, early: boolean): PingPongFault | undefined => {
  const limit = (early ? EARLY_MARGIN : LATE_MARGIN) - FAULT_BAND
  if (distance <= limit) return undefined
  return early ? 'OUT' : 'NET'
}

/** 리턴의 성격 — 폴트가 있으면 그것이 이기고, 없으면 이상점과의 거리로 등급이 갈린다. */
const returnKind = (
  distance: number,
  fault: PingPongFault | undefined,
): { readonly speed: number; readonly smash: boolean; readonly type: PingPongEventType } => {
  // 폴트 공도 속도가 다르다: OUT은 세게 넘어가고 NET은 눌려서 약하다.
  if (fault === 'OUT') return { speed: NORMAL_SPEED, smash: false, type: 'OUT' }
  if (fault === 'NET') return { speed: WEAK_SPEED, smash: false, type: 'NET' }
  if (distance <= PERFECT_DISTANCE) return { speed: SMASH_SPEED, smash: true, type: 'SMASH' }
  if (distance <= GOOD_DISTANCE) return { speed: NORMAL_SPEED, smash: false, type: 'NICE' }
  return { speed: WEAK_SPEED, smash: false, type: 'OK' }
}

/**
 * 실제 탁구의 서브 교대 규칙. 상태가 서브권이 아니라 **"다음 서브를 받을 사람"**
 * 을 저장하므로 같은 인덱스를 2점 동안 유지한 뒤 바꾼다. 10:10(합계 20)부터는
 * 매 점마다 바뀐다.
 */
export const serveReceiver = (
  playerOrder: readonly string[],
  scores: PingPongPlayerNumbers,
): string => {
  const first = scores[playerOrder[0] as string] ?? 0
  const second = scores[playerOrder[1] as string] ?? 0
  const total = first + second
  // Stryker disable next-line EqualityOperator,ArithmeticOperator: 이 자리에서 쓰는 것은
  // 순번의 **홀짝**뿐이라(바로 아래 `% 2`) 20에서의 두 식은 같은 값을 주고, 20 이후로는
  // 더하든 빼든 홀짝이 함께 움직인다. 어떤 검사로도 가를 수 없다.
  const serviceTurn = total < 20 ? Math.floor(total / 2) : 10 + (total - 20)
  return playerOrder[serviceTurn % 2] as string
}

/**
 * 스윙을 판정할 시각. 메시지가 **도착한** 순간으로 재면 업링크 지연이 통째로
 * "늦게 침"이 된다 — 이상점 0.9에서 네트 판정이 시작되는 1.02까지가 0.12뿐이라
 * 보통 속도(1.0 pos/s)에서 120ms만 밀려도 눈으로 완벽하게 맞춘 스윙이 네트로
 * 떨어진다(스매시 리턴은 62ms). 그래서 클라가 찍은 시각으로 판정하되 되감을 수
 * 있는 폭을 묶는다.
 * - `clientTs > now` → 서버 시각으로 자른다(미래에서 온 스윙은 없다)
 * - 너무 오래된 값 → {@link MAX_ROLLBACK_MILLIS}까지만(죽은 공을 쳤다고 우기는 것 차단)
 *
 * 알려진 구멍: 클라 시계가 서버보다 뒤져 있으면 그만큼 공짜 되감기를 얻는다
 * (최대 120ms). 시계에서 완전히 벗어나려면 `clientTs` 대신 "이 공 상태를 받은 뒤
 * 흐른 ms"를 보내고 `launchedAt`에 더해야 한다 — 그때 이 함수는 사라진다.
 * 와이어 계약을 바꾸는 일이라 지금은 그대로 둔다.
 */
export const judgedAt = (now: number, clientTs: number): number =>
  Math.max(now - MAX_ROLLBACK_MILLIS, Math.min(now, clientTs))

/**
 * 판이 시작될 때의 상태. PREPARING이고 `nextActionAt=0`이라 **타이머가 걸리지
 * 않는다** — 두 사람이 연습 스윙 후 ready를 누를 때까지 아무 일도 일어나지 않는다.
 */
export const initial = (players: readonly string[], now: number): PingPongState => {
  if (players.length !== 2) throw new DomainError('ping_pong_requires_two_players')
  const scores: Record<string, number> = {}
  const sequences: Record<string, number> = {}
  for (const player of players) {
    scores[player] = 0
    sequences[player] = -1
  }
  const first = players[0] as string
  return {
    version: 1,
    phase: 'PREPARING',
    playerOrder: [...players],
    scores,
    lastInputSeq: sequences,
    readyPlayerIds: [],
    ball: {
      pos: 0,
      direction: 1,
      speed: NORMAL_SPEED,
      smash: false,
      faultFrom: 0,
      x0: 0.5,
      x1: 0.5,
      launchedAt: now,
    },
    rally: 0,
    serveReceiverId: first,
    nextActionAt: 0,
    lastEvent: event(1, 'READY', first, now),
  }
}

/**
 * 준비 완료 선언. **연습 스윙을 한 뒤에만 유효하다**(`lastInputSeq >= 0`) —
 * "모션 입력이 실제로 동작한다"는 핸드셰이크라, 입력이 안 잡히는 클라이언트가
 * 경기를 시작해 버리는 것을 막는다. 조건에 안 맞으면 **상태를 그대로** 돌려준다.
 */
export const ready = (state: PingPongState, playerId: string, now: number): PingPongState => {
  if (
    state.phase !== 'PREPARING' ||
    !state.playerOrder.includes(playerId) ||
    lastSeqOf(state.lastInputSeq, playerId) < 0 ||
    state.readyPlayerIds.includes(playerId)
  ) {
    return state
  }
  const readyPlayerIds = [...state.readyPlayerIds, playerId]
  const version = state.version + 1
  const everyoneReady = state.playerOrder.every((player) => readyPlayerIds.includes(player))
  return {
    ...state,
    version,
    phase: everyoneReady ? 'COUNTDOWN' : 'PREPARING',
    readyPlayerIds,
    nextActionAt: everyoneReady ? now + POINT_COUNTDOWN_MILLIS : 0,
    lastEvent: event(version, 'PLAYER_READY', playerId, now),
  }
}

/**
 * 카운트다운 만료 → 서브. 공은 리시버의 **반대쪽 끝**에서 출발한다.
 * @param targetX 좌우 목표점(서버 RNG). 클라이언트가 정하지 않는다.
 */
export const serve = (state: PingPongState, now: number, targetX: number): PingPongState => {
  if (state.phase !== 'COUNTDOWN') return state
  // Stryker disable next-line StringLiteral: 명단에 없는 문자열이면 무엇이든 -1이 된다.
  const receiver = state.playerOrder.indexOf(state.serveReceiverId ?? '')
  const direction: PingPongDirection = receiver === 0 ? 1 : -1
  const ball: PingPongBall = {
    // Stryker disable next-line EqualityOperator: direction은 ±1뿐이다.
    pos: direction > 0 ? 0 : 1,
    direction,
    speed: NORMAL_SPEED,
    smash: false,
    faultFrom: 0,
    x0: 0.5,
    x1: targetX,
    launchedAt: now,
  }
  const version = state.version + 1
  return {
    ...state,
    version,
    phase: 'PLAYING',
    ball,
    rally: 0,
    nextActionAt: missDeadline(ball, now),
    lastEvent: event(version, 'SERVE', state.serveReceiverId as string, now),
  }
}

/**
 * 공을 건드릴 수 없는 국면의 스윙 — **입력 번호만 적고 끝난다.**
 * PREPARING은 연습(PRACTICE) 이벤트까지 남기고, 그 밖(COUNTDOWN·FINISHED·폴트
 * 공이 날아가는 중)은 version만 +1 한다. 판정 대상이면 `undefined`.
 */
const recordOnly = (
  state: PingPongState,
  playerId: string,
  lastInputSeq: Record<string, number>,
  now: number,
): PingPongState | undefined => {
  if (state.phase === 'PREPARING') {
    const version = state.version + 1
    return {
      ...state,
      version,
      lastInputSeq,
      nextActionAt: 0,
      lastEvent: event(version, 'PRACTICE', playerId, now),
    }
  }
  if (state.phase !== 'PLAYING' || state.ball.fault !== undefined) {
    return { ...state, version: state.version + 1, lastInputSeq }
  }
  return undefined
}

/** 판정 창을 벗어난 헛스윙의 이벤트. 창 안이면 `undefined`. */
const missedWindow = (seat: number, pos: number): PingPongEventType | undefined => {
  if (seat === 0 ? pos < WINDOW_1_LOW : pos > WINDOW_2_HIGH) return 'TOO_EARLY'
  if (seat === 0 ? pos > WINDOW_1_HIGH : pos < WINDOW_2_LOW) return 'TOO_LATE'
  return undefined
}

/**
 * 스윙 판정. `now`는 이미 {@link judgedAt}로 보정된 "친 순간"이다.
 *
 * 무시/기록만 하는 갈래가 여럿인 것이 계약이다:
 * - 참가자가 아니거나 이미 본 `inputSeq` → **상태 그대로**(중복·역순 입력 방어)
 * - PREPARING → PRACTICE 이벤트(입력 번호만 기록, 공은 안 움직인다)
 * - PLAYING이 아니거나 폴트 공이 날아가는 중 → 입력 번호만 기록(version만 +1)
 * - 내게 오는 공이 아님 → 입력 번호만 기록
 * - 판정 창 밖 → TOO_EARLY/TOO_LATE 이벤트. **공은 그대로 날아간다**(헛스윙)
 */
export const swing = (
  state: PingPongState,
  playerId: string,
  inputSeq: number,
  now: number,
  targetX: number,
): PingPongState => {
  const seat = seatOf(state, playerId)
  if (seat < 0 || inputSeq <= lastSeqOf(state.lastInputSeq, playerId)) return state

  const lastInputSeq: Record<string, number> = { ...state.lastInputSeq, [playerId]: inputSeq }
  const recorded = recordOnly(state, playerId, lastInputSeq, now)
  if (recorded !== undefined) return recorded

  // 판정은 "친 순간"의 공 위치로 한다 — 궤적이 같으므로 재표현일 뿐이다.
  const current = ballAt(state.ball, now)
  // Stryker disable next-line EqualityOperator: direction은 ±1뿐이다.
  const incoming = seat === 0 ? current.direction > 0 : current.direction < 0
  if (!incoming) {
    return { ...state, version: state.version + 1, lastInputSeq, ball: current }
  }

  const missed = missedWindow(seat, current.pos)
  if (missed !== undefined) {
    const version = state.version + 1
    return {
      ...state,
      version,
      lastInputSeq,
      ball: current,
      lastEvent: event(version, missed, playerId, now),
    }
  }

  const ideal = seat === 0 ? IDEAL_1 : IDEAL_2
  const distance = Math.abs(current.pos - ideal)
  // Stryker disable next-line EqualityOperator: 이상점에 정확히 맞은 스윙은 거리가 0이라
  // 이른 쪽으로 세든 늦은 쪽으로 세든 폴트가 나지 않는다 — 경계가 결과를 가르지 않는다.
  const early = seat === 0 ? current.pos < ideal : current.pos > ideal
  const fault = faultOf(distance, early)
  const direction: PingPongDirection = seat === 0 ? -1 : 1
  const { speed, smash, type } = returnKind(distance, fault)

  const returned: PingPongBall = {
    pos: current.pos,
    direction,
    speed,
    smash,
    ...(fault === undefined ? {} : { fault }),
    faultFrom: progress(current.pos, direction),
    x0: ballX(current),
    x1: targetX,
    launchedAt: now,
  }
  const version = state.version + 1
  return {
    ...state,
    version,
    lastInputSeq,
    ball: returned,
    rally: fault === undefined ? state.rally + 1 : state.rally,
    nextActionAt: flightDeadline(returned, now),
    lastEvent: event(version, type, playerId, now),
  }
}

/**
 * 마감. 폴트 공은 **친 쪽의 상대**가 득점하고(공이 상대에게 가던 중이므로
 * direction으로 되짚는다), 폴트 없는 공은 **받지 못한 쪽의 상대**가 득점한다.
 */
export const expire = (state: PingPongState, now: number): PingPongState => {
  if (state.phase !== 'PLAYING') return state
  const ball = ballAt(state.ball, now)
  const scorer =
    // Stryker disable next-line EqualityOperator: direction은 ±1뿐이다.
    ball.fault !== undefined ? (ball.direction < 0 ? 1 : 0) : ball.direction > 0 ? 1 : 0
  return point(state, scorer, ball, now)
}

/**
 * 이탈 몰수 — 남은 사람이 {@link WIN_SCORE}로 즉시 이긴다.
 * **PREPARING 중 이탈은 이 경로로 오지 않는다**(시작도 안 한 매치를 이겼다고 주지
 * 않는다 — `pingPongGameService.ts`의 취소 시퀀스).
 */
export const forfeit = (state: PingPongState, playerId: string, now: number): PingPongState => {
  const loser = seatOf(state, playerId)
  if (loser < 0 || state.phase === 'FINISHED') return state
  const winnerId = state.playerOrder[loser === 0 ? 1 : 0] as string
  const version = state.version + 1
  return {
    ...state,
    version,
    phase: 'FINISHED',
    scores: { ...state.scores, [winnerId]: WIN_SCORE },
    serveReceiverId: undefined,
    nextActionAt: 0,
    lastEvent: event(version, 'OPPONENT_LEFT', winnerId, now),
  }
}

/** 11점 선취 + **2점 차**(듀스). 아니면 다음 서브를 위한 COUNTDOWN으로 되돌아간다. */
const point = (
  state: PingPongState,
  scorer: number,
  ball: PingPongBall,
  now: number,
): PingPongState => {
  const scorerId = state.playerOrder[scorer] as string
  const score = (state.scores[scorerId] ?? 0) + 1
  const scores: Record<string, number> = { ...state.scores, [scorerId]: score }
  const opponentScore = scores[state.playerOrder[scorer === 0 ? 1 : 0] as string] ?? 0
  const version = state.version + 1
  const finished = score >= WIN_SCORE && score - opponentScore >= 2
  const phase: PingPongPhase = finished ? 'FINISHED' : 'COUNTDOWN'
  return {
    ...state,
    version,
    phase,
    scores,
    ball,
    serveReceiverId: finished ? undefined : serveReceiver(state.playerOrder, scores),
    nextActionAt: finished ? 0 : now + POINT_COUNTDOWN_MILLIS,
    lastEvent: event(version, finished ? 'GAME_OVER' : 'POINT', scorerId, now),
  }
}

/**
 * 대시보드가 보고한 상태를 받아들일지 판정한다 — 파티 모드 호스트 판정
 * (frontend ADR-0003). 서버는 **랠리를 다시 계산하지 않지만 아무거나 받지도 않는다.**
 *
 * 통과 조건 넷:
 *
 * 1. **보낸 사람이 플레이어가 아니어야 한다.** 대시보드는 방 스냅샷 명단에 없으므로
 * `playerOrder`에 없다. 플레이어가 자기 점수를 올리는 것을 막는 최소선이다.
 * 2. **version이 증가해야 한다.** 늦게 도착한 옛 상태가 진행을 되돌리면 안 된다
 * (결투의 "version 비증가 무시"와 같은 규칙).
 * 3. **roster를 바꿀 수 없다.** `playerOrder`가 서버가 만든 것과 같아야 한다 —
 * 대시보드가 참가자를 새로 정하는 통로가 되면 안 된다.
 * 4. **끝난 판은 다시 열리지 않는다.**
 *
 * @returns 받아들일 상태, 거절이면 null(스토어가 아무것도 쓰지 않는다).
 */
export const hostReport = (
  current: PingPongState,
  reported: PingPongState,
  senderId: string,
): PingPongState | null => {
  if (current.playerOrder.includes(senderId)) return null
  if (isPingPongFinished(current)) return null
  if (reported.version <= current.version) return null
  if (
    reported.playerOrder.length !== current.playerOrder.length ||
    reported.playerOrder.some((id, index) => id !== current.playerOrder[index])
  ) {
    return null
  }
  // roster는 서버 것을 그대로 쓴다 — 보고된 배열을 신뢰하지 않고 참조만 맞춘다.
  return { ...reported, playerOrder: current.playerOrder }
}
