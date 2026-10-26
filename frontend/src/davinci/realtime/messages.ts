import type { PlayerId } from '@/realtime/wsEvents'

/**
 * 다빈치 코드 와이어 메시지. 계약의 정본은 여전히 `@/realtime/wsEvents`이고, 이 파일은
 * 그중 다빈치 것만 모아 둔 곳이다(wsEvents가 re-export한다).
 */

export type DavinciTileColor = 'BLACK' | 'WHITE'
export type DavinciPhase = 'GUESSING' | 'DECIDING' | 'PLACING' | 'FINISHED'
export type DavinciEventKind = 'GUESS' | 'TIMEOUT' | 'FORFEIT'
export type DavinciDecision = 'CONTINUE' | 'STOP'

/** 조커의 숫자 자리. 실제 타일 숫자는 0~11이라 음수와 겹치지 않는다. */
export const DAVINCI_JOKER = -1

/**
 * 타일 하나. **색은 처음부터 보이고 숨는 것은 숫자뿐**이라, `number`가 null이면
 * "아직 아무도 못 맞힌 남의 타일"이라는 뜻이다.
 *
 * `id`는 서버가 섞은 뒤 붙인 자리 번호(`T0`~`T25`)라 숫자를 되짚을 수 없다 —
 * 추측을 보낼 때 타일을 가리키는 값이기도 하다.
 */
export interface DavinciTile {
  id: string
  color: DavinciTileColor
  number: number | null
  revealed: boolean
}

export interface DavinciEvent {
  kind: DavinciEventKind
  actorId: PlayerId
  targetId?: PlayerId | null
  tileId?: string | null
  number?: number | null
  correct: boolean
  at: number
}

/**
 * S→C: **보는 사람마다 다른** 판의 모습.
 *
 * 다른 게임의 상태 방송과 갈리는 유일한 지점이다. 서버는 이 게임에서만 방 전체에
 * 같은 프레임을 쏘지 않고 좌석마다 숫자를 깎아 따로 보낸다 — 감춘 숫자를 한 프레임에
 * 실으면 개발자 도구를 연 사람이 판을 다 알게 된다.
 */
export interface DavinciView {
  version: number
  phase: DavinciPhase
  playerOrder: PlayerId[]
  turnPlayerId: PlayerId
  hands: Record<PlayerId, DavinciTile[]>
  deckCount: number
  /** 이번 턴에 뽑아 아직 손에 넣지 않은 타일. 색은 모두에게, 숫자는 뽑은 사람에게만. */
  drawn?: DavinciTile | null
  turn: number
  eliminated: PlayerId[]
  winnerId?: PlayerId | null
  /** 맞혀서 공개시킨 상대 타일 수. 점수의 절반이다. */
  hits: Record<PlayerId, number>
  lastInputSeq: Record<PlayerId, number>
  nextActionAt: number
  lastEvent?: DavinciEvent | null
}

export interface DavinciGuessPayload {
  inputSeq: number
  targetId: PlayerId
  tileId: string
  /** 0~11, 조커는 {@link DAVINCI_JOKER}. */
  number: number
}

export interface DavinciDecidePayload {
  inputSeq: number
  decision: DavinciDecision
}

/** `index`는 손패 왼쪽부터의 삽입 자리(0부터 손패 길이까지). */
export interface DavinciPlacePayload {
  inputSeq: number
  index: number
}
