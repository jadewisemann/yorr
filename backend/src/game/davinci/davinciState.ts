/**
 * 다빈치 코드 한 판의 전체 상태.
 *
 * **이 객체는 그대로 나가지 않는다.** 결투·탁구의 상태는 전부 공개 정보라 방 전체에
 * 한 번 직렬화해 뿌리면 그만이지만, 다빈치 코드는 감춘 숫자가 게임 그 자체다. 서버가
 * 들고 있는 이 타입에는 모든 타일의 숫자가 들어 있고, 소켓으로 나가는 것은 보는 사람에
 * 맞춰 숫자를 지운 {@link DavinciView}다(`toView`). 상태를 그대로 방송하면 개발자
 * 도구를 연 사람이 전부 맞힌다.
 *
 * 와이어 정본은 `frontend/src/realtime/wsEvents.ts`의 `DavinciView`다.
 */

/** 타일 뒷면 색. **색은 처음부터 공개**되고 숨는 것은 숫자뿐이다. */
export type DavinciTileColor = 'BLACK' | 'WHITE'

/** 조커의 숫자 자리. 실제 숫자는 0~11이라 음수와 겹치지 않는다. */
export const DAVINCI_JOKER = -1

type DavinciPhase =
  /** 턴 플레이어가 상대 타일 하나를 지목해 숫자를 맞힐 차례다. */
  | 'GUESSING'
  /** 맞혔다 — 계속 추측할지 멈출지 고르는 중이다. */
  | 'DECIDING'
  /** 턴을 끝내며 손에 넣는 타일이 조커라 놓을 자리를 고르는 중이다. */
  | 'PLACING'
  | 'FINISHED'

/**
 * 타일 하나. `id`는 **셔플 뒤의 자리 번호**(`T0`~`T25`)라 숫자를 흘리지 않는다 —
 * `B7` 같은 식별자를 쓰면 감춘 타일의 id만 보고 답을 알 수 있다.
 */
export interface DavinciTile {
  readonly id: string
  readonly color: DavinciTileColor
  /** 0~11, 조커는 {@link DAVINCI_JOKER}. */
  readonly number: number
  /** 공개된 타일은 모두에게 숫자가 보인다. */
  readonly revealed: boolean
}

type DavinciEventKind =
  /** 추측했다 — 맞았는지는 `correct`가 말한다. */
  | 'GUESS'
  /** 제한 시간을 넘겼다. 추측 차례였다면 틀린 것과 같게 처리된다. */
  | 'TIMEOUT'
  /** 게임 중 방을 떠났다. */
  | 'FORFEIT'

/**
 * 직전에 일어난 일 하나. 화면의 연출(맞음·틀림·탈락 표시)이 전부 여기서 나온다.
 * 결투의 `lastRound`와 같은 자리이고, 같은 이유로 없을 때는 **필드가 생략**된다.
 */
export interface DavinciEvent {
  readonly kind: DavinciEventKind
  /** 이 사건을 일으킨 사람 — 추측자, 시간을 넘긴 사람, 떠난 사람이다. */
  readonly actorId: string
  readonly targetId: string | null
  readonly tileId: string | null
  readonly number: number | null
  readonly correct: boolean
  readonly at: number
}

/** playerId → 값. JSON 객체로 직렬화된다(결투 `DuelPlayerNumbers`와 같은 자리). */
export type DavinciPlayerNumbers = Readonly<Record<string, number>>

export interface DavinciState {
  /** 모든 변이마다 +1. 스케줄러 키이자 스토어의 갱신 판정 기준이다. */
  readonly version: number
  readonly phase: DavinciPhase
  /** 자리 순서. 턴은 이 순서를 돌며 **탈락자를 건너뛴다**. */
  readonly playerOrder: readonly string[]
  readonly turnPlayerId: string
  /** playerId → 왼쪽부터의 타일 배열. 정렬 규칙은 `davinciRules.ts`가 지킨다. */
  readonly hands: Readonly<Record<string, readonly DavinciTile[]>>
  /** 남은 더미. 위(index 0)부터 뽑는다. */
  readonly deck: readonly DavinciTile[]
  /** 이번 턴에 뽑아 **아직 손에 넣지 않은** 타일. 더미가 비었으면 null이다. */
  readonly drawn: DavinciTile | null
  /** 1부터 세는 턴 번호. 턴이 넘어갈 때만 오른다. */
  readonly turn: number
  readonly eliminated: readonly string[]
  readonly winnerId: string | null
  /** 이번 판에서 맞혀 공개시킨 상대 타일 수 — 점수의 절반이다(`davinciRules.ts`). */
  readonly hits: DavinciPlayerNumbers
  readonly lastInputSeq: DavinciPlayerNumbers
  readonly nextActionAt: number
  /** 없으면 **필드 자체가 생략**된다. */
  readonly lastEvent?: DavinciEvent | undefined
}

/** 숫자가 지워질 수 있는 타일. `number`가 null이면 보는 사람에게 감춰진 것이다. */
export interface DavinciTileView {
  readonly id: string
  readonly color: DavinciTileColor
  readonly number: number | null
  readonly revealed: boolean
}

/**
 * 한 사람에게 보내는 판의 모습. `deck`은 장수만 남고, 감춘 숫자는 **보는 사람의
 * 것과 이미 공개된 것만** 살아남는다.
 */
export interface DavinciView {
  readonly version: number
  readonly phase: DavinciPhase
  readonly playerOrder: readonly string[]
  readonly turnPlayerId: string
  readonly hands: Readonly<Record<string, readonly DavinciTileView[]>>
  readonly deckCount: number
  readonly drawn: DavinciTileView | null
  readonly turn: number
  readonly eliminated: readonly string[]
  readonly winnerId: string | null
  readonly hits: DavinciPlayerNumbers
  readonly lastInputSeq: DavinciPlayerNumbers
  readonly nextActionAt: number
  readonly lastEvent?: DavinciEvent | undefined
}

/**
 * 숫자를 보여 줄 것인가 — 공개된 타일이거나 **내 타일**이거나 **판이 끝났으면** 보여 준다.
 *
 * 끝난 판을 여는 이유: 결과 화면의 값은 "누가 무엇을 끝까지 감췄는가"다. 이긴 사람의
 * 타일이 물음표로 남으면 진 사람은 자기가 무엇을 못 맞혔는지 영영 모른다.
 *
 * **`revealed`는 건드리지 않는다.** 그 값이 점수의 재료이기 때문이다 — 화면의 점수는
 * `맞힌 수 + 감춘 수`이고 감춘 수는 `revealed === false`를 센다. 여기서 함께 뒤집으면
 * 이긴 사람의 점수가 판이 끝나는 순간 0으로 무너진다. 숫자만 열고 자세는 그대로 둔다.
 */
const visible = (tile: DavinciTile, mine: boolean, over: boolean): boolean =>
  tile.revealed || mine || over

const tileView = (tile: DavinciTile, mine: boolean, over: boolean): DavinciTileView => ({
  id: tile.id,
  color: tile.color,
  number: visible(tile, mine, over) ? tile.number : null,
  revealed: tile.revealed,
})

/**
 * 상태를 **보는 사람 기준으로** 깎는다.
 *
 * @param viewerId 이 시점을 보는 사람. 파티 대시보드처럼 플레이어가 아닌 화면은
 *   `null`을 넘긴다 — 그러면 공개된 숫자만 남아 관전 시점이 된다.
 *
 * 뽑아 든 타일(`drawn`)은 색만 모두에게 보인다. 실제 게임에서도 뽑은 타일을 자기
 * 쪽으로 세워 드는 순간 색은 드러나고 숫자는 본인만 본다 — 그 비대칭이 다음 턴의
 * 추론 재료라 서버가 색까지 지우면 안 된다.
 */
export const toView = (state: DavinciState, viewerId: string | null): DavinciView => {
  const over = state.phase === 'FINISHED'
  const hands: Record<string, DavinciTileView[]> = {}
  for (const [playerId, tiles] of Object.entries(state.hands)) {
    hands[playerId] = tiles.map((tile) => tileView(tile, playerId === viewerId, over))
  }
  return {
    version: state.version,
    phase: state.phase,
    playerOrder: state.playerOrder,
    turnPlayerId: state.turnPlayerId,
    hands,
    deckCount: state.deck.length,
    drawn:
      state.drawn === null ? null : tileView(state.drawn, state.turnPlayerId === viewerId, over),
    turn: state.turn,
    eliminated: state.eliminated,
    winnerId: state.winnerId,
    hits: state.hits,
    lastInputSeq: state.lastInputSeq,
    nextActionAt: state.nextActionAt,
    lastEvent: state.lastEvent,
  }
}
