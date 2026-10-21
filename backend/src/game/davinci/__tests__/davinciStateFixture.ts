import { DAVINCI_JOKER, type DavinciState, type DavinciTile } from '../davinciState.js'

/**
 * 다빈치 상태 픽스처 — 저장소 테스트가 쓰는 **직렬화 가능한 최소 상태**.
 *
 * `initialDavinciState`를 쓰지 않는 이유: 그 함수는 26장 셔플 순서를 요구해서
 * 저장소 테스트가 덱 구성 규칙에 묶인다. 여기서 보는 것은 락·SETNX·TTL·version
 * 판정이고, 그 판정은 상태의 어느 필드가 채워졌는지와 무관하다.
 */
const tile = (id: string, number: number): DavinciTile => ({
  id,
  color: 'BLACK',
  number,
  revealed: false,
})

export const dieDavinciState = (overrides: Partial<DavinciState> = {}): DavinciState => ({
  version: 1,
  phase: 'GUESSING',
  playerOrder: ['player-1', 'player-2'],
  turnPlayerId: 'player-1',
  hands: {
    'player-1': [tile('T0', 3), tile('T1', 7)],
    'player-2': [tile('T2', 1), tile('T3', 9)],
  },
  deck: [tile('T4', 5), tile('T5', DAVINCI_JOKER)],
  drawn: null,
  turn: 1,
  eliminated: [],
  winnerId: null,
  hits: {},
  lastInputSeq: {},
  nextActionAt: 1_000,
  ...overrides,
})
