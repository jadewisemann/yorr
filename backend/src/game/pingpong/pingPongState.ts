/**
 * 탁구 한 판의 전체 상태 — backend-java `game/pingpong/PingPongState`.
 *
 * 방마다 하나씩 Redis에 직렬화되어 살아 있고, **그대로 WebSocket으로도 나간다**
 * (`game.ping_pong.state`의 payload는 래핑 없이 이 객체다). 화면은 이 값과
 * 자기 시계만으로 공을 그린다 — 서버가 프레임을 보내지 않는다.
 *
 * DESIGN.md 원칙 2(「물리는 연출이다」)의 자리: 클라이언트가 보내는 것은
 * `swing{inputSeq, clientTs}` 하나뿐이고 공의 위치·속도·판정은 전부 여기 있는
 * 값에서 서버가 해석적으로(틱 없이) 계산한다. 클라이언트가 계산한 궤적이나
 * 판정을 상태에 반영하는 경로는 존재하지 않는다.
 *
 * 와이어 정본은 `frontend/src/realtime/wsEvents.ts`의 `PingPongState`다.
 * null 취급은 Java `@JsonInclude(NON_NULL)`을 그대로 따른다 — `fault`·
 * `serveReceiverId`·`lastEvent`가 없으면 **필드 자체가 생략**되므로
 * `undefined`로 둔다(`JSON.stringify`가 지운다).
 */

export type PingPongPhase =
  /** 준비 게이트 — 연습 스윙 + ready 핸드셰이크. 타이머 없음(`nextActionAt=0`). */
  | 'PREPARING'
  /** 다음 서브까지의 카운트다운(2.6초). 만료되면 서버가 서브한다. */
  | 'COUNTDOWN'
  /** 랠리 진행 중. */
  | 'PLAYING'
  | 'FINISHED'

/** 폴트 종류. 판정 창 안에서도 이상점에서 너무 멀면 붙는다. */
export type PingPongFault =
  /** 너무 이르게 쳐서 테이블 밖으로 넘어간다. */
  | 'OUT'
  /** 너무 늦게 쳐서 네트에 걸린다. */
  | 'NET'

export type PingPongEventType =
  /** 초기 상태의 자리표시 이벤트(누구의 서브를 기다리는지). */
  | 'READY'
  /** PREPARING 중 연습 스윙 — 모션 입력이 동작한다는 신호. */
  | 'PRACTICE'
  | 'PLAYER_READY'
  | 'SERVE'
  /** 판정 창보다 이른 헛스윙 — 공은 그대로 날아간다. */
  | 'TOO_EARLY'
  /** 판정 창보다 늦은 헛스윙. */
  | 'TOO_LATE'
  | 'OK'
  | 'NICE'
  | 'SMASH'
  | 'OUT'
  | 'NET'
  | 'POINT'
  | 'GAME_OVER'
  | 'OPPONENT_LEFT'

/** `+1`은 playerOrder[0]에게 다가가는 방향이다. */
export type PingPongDirection = 1 | -1

/**
 * 공의 궤적 — **틱이 없다.** 현재 위치는 `pos + direction × speed × 경과초`로
 * 언제든 다시 계산된다(`pingPongRules.ts`의 `ballAt`).
 */
export interface PingPongBall {
  /** `launchedAt` 시점의 1차원 위치. 0 ↔ 1이 두 플레이어의 라켓 면이다. */
  readonly pos: number
  readonly direction: PingPongDirection
  /** pos/초. NORMAL 1.0 · SMASH 1.95 · WEAK 0.82. */
  readonly speed: number
  readonly smash: boolean
  /** 폴트가 붙은 공은 상대가 받을 수 없다 — 마감 시 친 쪽이 실점한다. */
  readonly fault?: PingPongFault | undefined
  /** 폴트 연출의 시작 진행률(0~1). 폴트가 없어도 채워진다(Java와 같음). */
  readonly faultFrom: number
  /** 좌우 위치의 시작점. 진행률 0.5가 네트 통과 지점이다. */
  readonly x0: number
  /** 좌우 목표점 — 서버 RNG(0.15~0.85)가 정한다. */
  readonly x1: number
  readonly launchedAt: number
}

/**
 * 직전 판정 하나. 화면의 이펙트·효과음이 전부 이 한 줄에서 나온다.
 * `id`는 상태 version과 같은 값이라 클라이언트가 중복 재생을 막을 수 있다.
 */
export interface PingPongEvent {
  readonly id: number
  readonly type: PingPongEventType
  readonly playerId: string
  readonly at: number
}

/** playerId → 값. Java `Map<String, Integer>`·`Map<String, Long>` 자리. */
export type PingPongPlayerNumbers = Readonly<Record<string, number>>

export interface PingPongState {
  /** 모든 변이마다 +1. 스케줄러 키이자 스토어의 갱신 판정 기준이다. */
  readonly version: number
  readonly phase: PingPongPhase
  /** 2명 고정. `[0]`이 pos 0 쪽, `[1]`이 pos 1 쪽이다. */
  readonly playerOrder: readonly string[]
  readonly scores: PingPongPlayerNumbers
  /** 마지막으로 받은 입력 번호. **-1이면 아직 연습 스윙조차 없다**(ready 게이트). */
  readonly lastInputSeq: PingPongPlayerNumbers
  /** LinkedHashSet 자리 — 순서 있는 중복 없는 목록이다. */
  readonly readyPlayerIds: readonly string[]
  readonly ball: PingPongBall
  /** 폴트 없는 리턴에만 +1. 득점해도 리셋되지 않는다(Java와 같음). */
  readonly rally: number
  /** **서브권이 아니라 리시버**를 저장한다(서브 로테이션 계산의 근간). */
  readonly serveReceiverId?: string | undefined
  /** 서브 또는 실점 마감 시각(epoch ms). 0이면 예약이 없다. */
  readonly nextActionAt: number
  readonly lastEvent?: PingPongEvent | undefined
}

export const isPingPongFinished = (state: PingPongState): boolean => state.phase === 'FINISHED'

/** WS `game.ping_pong.swing` 페이로드(정본: `frontend/src/realtime/wsEvents.ts`). */
export interface PingPongSwingPayload {
  readonly inputSeq: number
  /** 클라이언트가 스윙을 찍은 시각. 판정 시각 보정은 `judgedAt`이 한다. */
  readonly clientTs: number
}
