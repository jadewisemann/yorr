import { describe, expect, it } from 'vitest'
import {
  compareTiles,
  DAVINCI_DECK_SIZE,
  DAVINCI_TILES,
  decide,
  expire,
  forfeit,
  guess,
  initialDavinciState,
  insertIndexOf,
  isGuessableNumber,
  place,
  scoreOf,
} from '../davinciRules.js'
import { DAVINCI_JOKER, type DavinciState, type DavinciTile, toView } from '../davinciState.js'
import {
  BLACK,
  BLACK_JOKER,
  deckOrder,
  GUEST,
  HOST,
  NOW,
  numbersOf,
  THIRD,
  tilesOf,
  twoPlayerState,
  WHITE,
} from './davinciFixtures.js'

describe('타일 정렬', () => {
  it('숫자 오름차순으로, 같은 숫자면 검정이 왼쪽이다', () => {
    expect(compareTiles({ color: 'BLACK', number: 3 }, { color: 'WHITE', number: 5 })).toBeLessThan(
      0,
    )
    expect(
      compareTiles({ color: 'WHITE', number: 7 }, { color: 'BLACK', number: 7 }),
    ).toBeGreaterThan(0)
    expect(compareTiles({ color: 'BLACK', number: 7 }, { color: 'BLACK', number: 7 })).toBe(0)
  })

  it('새 타일은 규칙이 허용하는 가장 왼쪽에 들어간다', () => {
    const hand: DavinciTile[] = [
      { id: 'a', color: 'BLACK', number: 2, revealed: false },
      { id: 'b', color: 'WHITE', number: 6, revealed: false },
    ]
    expect(insertIndexOf(hand, { color: 'BLACK', number: 0 })).toBe(0)
    expect(insertIndexOf(hand, { color: 'BLACK', number: 6 })).toBe(1)
    expect(insertIndexOf(hand, { color: 'WHITE', number: 9 })).toBe(2)
  })

  it('조커는 비교에서 건너뛰므로 새 타일이 조커 왼쪽에 붙는다', () => {
    const hand: DavinciTile[] = [
      { id: 'a', color: 'BLACK', number: 2, revealed: false },
      { id: 'j', color: 'WHITE', number: DAVINCI_JOKER, revealed: false },
      { id: 'b', color: 'WHITE', number: 8, revealed: false },
    ]
    expect(insertIndexOf(hand, { color: 'BLACK', number: 5 })).toBe(1)
  })

  it('조커와 0~11만 부를 수 있는 숫자다', () => {
    expect(isGuessableNumber(DAVINCI_JOKER)).toBe(true)
    expect(isGuessableNumber(0)).toBe(true)
    expect(isGuessableNumber(11)).toBe(true)
    expect(isGuessableNumber(12)).toBe(false)
    expect(isGuessableNumber(1.5)).toBe(false)
  })
})

describe('첫 상태', () => {
  it('2인은 넷씩 나눠 갖고 첫 턴은 자리 순서의 첫 사람이다', () => {
    const state = twoPlayerState()
    expect(state.playerOrder).toEqual([HOST, GUEST])
    expect(state.turnPlayerId).toBe(HOST)
    expect(tilesOf(state, HOST)).toHaveLength(4)
    expect(tilesOf(state, GUEST)).toHaveLength(4)
    expect(state.phase).toBe('GUESSING')
    expect(state.drawn).not.toBeNull()
  })

  it('4인은 셋씩 나눠 갖는다', () => {
    const state = initialDavinciState([HOST, GUEST, THIRD, 'player-4'], deckOrder(), NOW)
    for (const playerId of state.playerOrder) {
      expect(tilesOf(state, playerId)).toHaveLength(3)
    }
  })

  it('손패는 정렬돼 있고 조커가 섞이지 않는다', () => {
    // 앞자리에 조커를 밀어 넣어도 나눠 주는 타일에서는 걸러진다.
    const state = twoPlayerState(BLACK_JOKER, WHITE(4), BLACK(4), WHITE(1), BLACK(9))
    expect(numbersOf(state, HOST)).toEqual([...numbersOf(state, HOST)].sort((a, b) => a - b))
    for (const playerId of state.playerOrder) {
      expect(numbersOf(state, playerId)).not.toContain(DAVINCI_JOKER)
    }
    // 걸러진 조커는 더미에 그대로 남는다.
    expect(state.deck.some((tile) => tile.number === DAVINCI_JOKER)).toBe(true)
  })

  it('같은 숫자면 검정이 왼쪽이다', () => {
    const state = twoPlayerState(WHITE(4), BLACK(4))
    const labels = tilesOf(state, HOST).map((tile) => `${tile.color[0]}${tile.number}`)
    expect(labels).toEqual(['B0', 'B1', 'B4', 'W4'])
  })

  it('스물여섯 장이 아닌 순서는 거부한다', () => {
    expect(() => initialDavinciState([HOST, GUEST], [0, 1, 2], NOW)).toThrow()
  })

  it('한 명이나 다섯 명으로는 시작하지 않는다', () => {
    expect(() => initialDavinciState([HOST], deckOrder(), NOW)).toThrow()
    expect(() => initialDavinciState([HOST, GUEST, THIRD, 'p4', 'p5'], deckOrder(), NOW)).toThrow()
  })
})

describe('추측', () => {
  const state = twoPlayerState()
  const targetTile = (source: DavinciState = state): DavinciTile => {
    const tile = tilesOf(source, GUEST)[0]
    if (tile === undefined) throw new Error('상대 타일이 없다')
    return tile
  }

  it('맞히면 그 타일이 공개되고 계속할지 고르는 단계로 간다', () => {
    const tile = targetTile()
    const next = guess(state, HOST, 0, GUEST, tile.id, tile.number, NOW)
    expect(next.phase).toBe('DECIDING')
    expect(tilesOf(next, GUEST)[0]?.revealed).toBe(true)
    expect(next.hits[HOST]).toBe(1)
    expect(next.lastEvent?.correct).toBe(true)
    expect(next.version).toBe(state.version + 1)
  })

  it('틀리면 뽑아 둔 타일이 공개된 채 손에 들어가고 턴이 넘어간다', () => {
    const tile = targetTile()
    const drawn = state.drawn
    const next = guess(state, HOST, 0, GUEST, tile.id, tile.number + 1, NOW)
    expect(next.phase).toBe('GUESSING')
    expect(next.turnPlayerId).toBe(GUEST)
    expect(next.turn).toBe(state.turn + 1)
    expect(tilesOf(next, HOST).find((candidate) => candidate.id === drawn?.id)?.revealed).toBe(true)
    expect(next.lastEvent?.correct).toBe(false)
    expect(next.hits[HOST]).toBe(0)
  })

  it('공개된 타일은 다시 부를 수 없다', () => {
    const tile = targetTile()
    const revealed = guess(state, HOST, 0, GUEST, tile.id, tile.number, NOW)
    const again = guess(
      { ...revealed, phase: 'GUESSING' },
      HOST,
      1,
      GUEST,
      tile.id,
      tile.number,
      NOW,
    )
    expect(again.version).toBe(revealed.version)
  })

  it('자기 차례가 아니거나 자기 타일을 부르면 무시한다', () => {
    const tile = targetTile()
    expect(guess(state, GUEST, 0, HOST, tile.id, 1, NOW).version).toBe(state.version)
    const mine = tilesOf(state, HOST)[0]
    expect(guess(state, HOST, 0, HOST, mine?.id ?? '', 1, NOW).version).toBe(state.version)
  })

  it('이미 처리한 inputSeq는 무시한다', () => {
    const tile = targetTile()
    const first = guess(state, HOST, 3, GUEST, tile.id, tile.number, NOW)
    const replay = guess({ ...first, phase: 'GUESSING' }, HOST, 3, GUEST, tile.id, 0, NOW)
    expect(replay.version).toBe(first.version)
  })

  it('새 타일은 정렬 자리에 들어간다', () => {
    // 손패는 B1~B4, 뽑은 타일은 B0이므로 가장 왼쪽으로 들어가야 한다.
    const sorted = twoPlayerState(
      BLACK(1),
      BLACK(2),
      BLACK(3),
      BLACK(4),
      BLACK(5),
      BLACK(6),
      BLACK(7),
      BLACK(8),
      BLACK(0),
    )
    // 상대의 첫 타일은 B5이므로 0은 유효하지만 틀린 추측이다.
    const tile = tilesOf(sorted, GUEST)[0]
    const next = guess(sorted, HOST, 0, GUEST, tile?.id ?? '', 0, NOW)
    expect(numbersOf(next, HOST)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('맞힌 뒤의 선택', () => {
  const opened = (): DavinciState => {
    const state = twoPlayerState()
    const tile = tilesOf(state, GUEST)[0]
    return guess(state, HOST, 0, GUEST, tile?.id ?? '', tile?.number ?? 0, NOW)
  }

  it('계속하면 같은 사람의 추측 차례가 이어진다', () => {
    const next = decide(opened(), HOST, 1, 'CONTINUE', NOW)
    expect(next.phase).toBe('GUESSING')
    expect(next.turnPlayerId).toBe(HOST)
  })

  it('멈추면 뽑아 둔 타일을 감춘 채 넣고 턴을 넘긴다', () => {
    const before = opened()
    const drawnId = before.drawn?.id
    const next = decide(before, HOST, 1, 'STOP', NOW)
    expect(next.turnPlayerId).toBe(GUEST)
    expect(tilesOf(next, HOST).find((tile) => tile.id === drawnId)?.revealed).toBe(false)
    expect(next.drawn?.id).not.toBe(drawnId)
  })
})

describe('조커', () => {
  /** 아홉 번째 타일(첫 턴에 뽑는 자리)에 검정 조커를 놓는다. */
  const withJokerDrawn = (): DavinciState =>
    twoPlayerState(
      BLACK(0),
      BLACK(1),
      BLACK(2),
      BLACK(3),
      BLACK(4),
      BLACK(5),
      BLACK(6),
      BLACK(7),
      BLACK_JOKER,
    )

  it('턴을 끝낼 때 자리를 고르는 단계로 간다', () => {
    const state = withJokerDrawn()
    expect(state.drawn?.number).toBe(DAVINCI_JOKER)
    const tile = tilesOf(state, GUEST)[0]
    const next = guess(state, HOST, 0, GUEST, tile?.id ?? '', 0, NOW)
    expect(next.phase).toBe('PLACING')
    expect(next.turnPlayerId).toBe(HOST)
  })

  it('고른 자리에 들어가고 턴이 넘어간다', () => {
    const tile = tilesOf(withJokerDrawn(), GUEST)[0]
    const placing = guess(withJokerDrawn(), HOST, 0, GUEST, tile?.id ?? '', 0, NOW)
    const next = place(placing, HOST, 1, 2, NOW)
    expect(next.phase).toBe('GUESSING')
    expect(next.turnPlayerId).toBe(GUEST)
    expect(numbersOf(next, HOST)[2]).toBe(DAVINCI_JOKER)
  })

  it('손패 밖의 자리는 무시한다', () => {
    const tile = tilesOf(withJokerDrawn(), GUEST)[0]
    const placing = guess(withJokerDrawn(), HOST, 0, GUEST, tile?.id ?? '', 0, NOW)
    expect(place(placing, HOST, 1, 99, NOW).version).toBe(placing.version)
    expect(place(placing, GUEST, 1, 0, NOW).version).toBe(placing.version)
  })

  it('놓기 단계에서도 이미 쓴 입력 번호는 무시한다', () => {
    const tile = tilesOf(withJokerDrawn(), GUEST)[0]
    const placing = guess(withJokerDrawn(), HOST, 0, GUEST, tile?.id ?? '', 0, NOW)

    expect(place(placing, HOST, 0, 2, NOW)).toBe(placing)
  })

  it('더미가 비었으면 틀린 사람이 자기 타일을 대신 공개한다', () => {
    const empty: DavinciState = { ...twoPlayerState(), deck: [], drawn: null }

    // 시간을 넘긴 턴은 "틀린 것"과 같게 다룬다.
    const next = expire(empty, NOW + 1)

    const revealed = tilesOf(next, HOST).filter((tile) => tile.revealed)
    expect(revealed).toHaveLength(1)
    expect(next.turnPlayerId).toBe(GUEST)
  })

  it('더미가 비었어도 맞히고 멈춘 턴에는 아무것도 공개하지 않는다', () => {
    const state = twoPlayerState()
    const empty: DavinciState = { ...state, deck: [], drawn: null }
    const tile = tilesOf(empty, GUEST)[0]

    const guessed = guess(empty, HOST, 0, GUEST, tile?.id ?? '', tile?.number ?? 0, NOW)
    const stopped = decide(guessed, HOST, 1, 'STOP', NOW)

    // 공개된 것은 맞힌 상대 타일 하나뿐이다 — 내 손패는 그대로다.
    expect(tilesOf(stopped, HOST).filter((each) => each.revealed)).toHaveLength(0)
    expect(stopped.turnPlayerId).toBe(GUEST)
  })

  it('공개할 타일도 없으면 그대로 턴만 넘긴다', () => {
    const state = twoPlayerState()
    const allRevealed: DavinciState = {
      ...state,
      deck: [],
      drawn: null,
      hands: {
        ...state.hands,
        [HOST]: tilesOf(state, HOST).map((tile) => ({ ...tile, revealed: true })),
      },
    }

    // 손패가 전부 공개된 사람은 그 자리에서 탈락하고, 2인이면 판이 끝난다.
    const next = expire(allRevealed, NOW + 1)

    expect(next.phase).toBe('FINISHED')
    expect(next.winnerId).toBe(GUEST)
  })

  it('상대가 이미 탈락했으면 턴을 넘기는 순간 판이 끝난다', () => {
    const state = twoPlayerState()
    const alone: DavinciState = { ...state, eliminated: [GUEST] }

    const next = expire(alone, NOW + 1)

    expect(next.phase).toBe('FINISHED')
    expect(next.winnerId).toBe(HOST)
  })
})

describe('승부', () => {
  it('상대 타일을 전부 맞히면 끝난다', () => {
    let state = twoPlayerState()
    let seq = 0
    for (const tile of tilesOf(state, GUEST)) {
      state = guess(state, HOST, seq, GUEST, tile.id, tile.number, NOW)
      seq += 1
      if (state.phase === 'DECIDING') {
        state = decide(state, HOST, seq, 'CONTINUE', NOW)
        seq += 1
      }
    }
    expect(state.phase).toBe('FINISHED')
    expect(state.winnerId).toBe(HOST)
    expect(state.eliminated).toContain(GUEST)
  })

  it('점수는 맞힌 수와 끝까지 감춘 타일 수의 합이다', () => {
    const state = twoPlayerState()
    const tile = tilesOf(state, GUEST)[0]
    const next = guess(state, HOST, 0, GUEST, tile?.id ?? '', tile?.number ?? 0, NOW)
    expect(scoreOf(next, HOST)).toBe(1 + 4)
    expect(scoreOf(next, GUEST)).toBe(0 + 3)
  })
})

describe('제한 시간', () => {
  it('추측을 넘기면 틀린 것과 같게 처리된다', () => {
    const state = twoPlayerState()
    const drawnId = state.drawn?.id
    const next = expire(state, NOW + 1)
    expect(next.turnPlayerId).toBe(GUEST)
    expect(tilesOf(next, HOST).find((tile) => tile.id === drawnId)?.revealed).toBe(true)
    expect(next.lastEvent?.kind).toBe('TIMEOUT')
  })

  it('멈춤을 넘기면 감춘 채 넣고 턴을 넘긴다', () => {
    const state = twoPlayerState()
    const tile = tilesOf(state, GUEST)[0]
    const deciding = guess(state, HOST, 0, GUEST, tile?.id ?? '', tile?.number ?? 0, NOW)
    const drawnId = deciding.drawn?.id
    const next = expire(deciding, NOW + 1)
    expect(next.turnPlayerId).toBe(GUEST)
    expect(tilesOf(next, HOST).find((candidate) => candidate.id === drawnId)?.revealed).toBe(false)
  })

  it('놓을 조커가 없는 배치 단계에서도 턴은 반드시 움직인다', () => {
    // 있어서는 안 되는 상태지만, 여기서 멈추면 이미 지난 마감으로 예약이 다시 걸려
    // 제자리를 돈다.
    const stuck: DavinciState = { ...twoPlayerState(), drawn: null, phase: 'PLACING' }

    const next = expire(stuck, NOW + 1)

    expect(next.turnPlayerId).toBe(GUEST)
    expect(next.nextActionAt).toBeGreaterThan(stuck.nextActionAt)
  })

  it('끝난 판에는 아무 일도 하지 않는다', () => {
    const finished: DavinciState = { ...twoPlayerState(), phase: 'FINISHED' }
    expect(expire(finished, NOW).version).toBe(finished.version)
  })
})

describe('이탈', () => {
  it('손패를 공개하고 탈락시킨다 — 2인이면 그대로 끝난다', () => {
    const state = twoPlayerState()
    const next = forfeit(state, GUEST, NOW)
    expect(next.phase).toBe('FINISHED')
    expect(next.winnerId).toBe(HOST)
    expect(tilesOf(next, GUEST).every((tile) => tile.revealed)).toBe(true)
    expect(next.lastEvent?.kind).toBe('FORFEIT')
  })

  it('3인 판에서 차례인 사람이 떠나면 다음 사람으로 넘어간다', () => {
    const state = initialDavinciState([HOST, GUEST, THIRD], deckOrder(), NOW)
    const next = forfeit(state, HOST, NOW)
    expect(next.phase).toBe('GUESSING')
    expect(next.turnPlayerId).toBe(GUEST)
    expect(next.eliminated).toEqual([HOST])
  })

  it('이미 떠난 사람은 다시 처리하지 않는다', () => {
    const state = initialDavinciState([HOST, GUEST, THIRD], deckOrder(), NOW)
    const once = forfeit(state, HOST, NOW)
    expect(forfeit(once, HOST, NOW).version).toBe(once.version)
  })
})

describe('시점', () => {
  it('남의 감춘 숫자는 지우고 색과 공개된 숫자만 남긴다', () => {
    const state = twoPlayerState()
    const view = toView(state, HOST)
    expect(view.hands[HOST]?.every((tile) => tile.number !== null)).toBe(true)
    expect(view.hands[GUEST]?.every((tile) => tile.number === null)).toBe(true)
    expect(view.hands[GUEST]?.every((tile) => tile.color !== undefined)).toBe(true)
    expect(view.deckCount).toBe(state.deck.length)
  })

  it('뽑아 둔 타일은 색만 모두에게 보이고 숫자는 뽑은 사람만 본다', () => {
    const state = twoPlayerState()
    expect(toView(state, HOST).drawn?.number).toBe(state.drawn?.number)
    expect(toView(state, GUEST).drawn?.number).toBeNull()
    expect(toView(state, GUEST).drawn?.color).toBe(state.drawn?.color)
  })

  it('판이 끝나면 남의 감춘 타일도 숫자가 열린다 — 점수의 재료인 revealed는 그대로다', () => {
    const state = twoPlayerState()
    const finished: DavinciState = { ...state, phase: 'FINISHED', winnerId: HOST }

    const view = toView(finished, GUEST)

    expect(view.hands[HOST]?.every((tile) => tile.number !== null)).toBe(true)
    expect(view.hands[HOST]?.every((tile) => !tile.revealed)).toBe(true)
    // 감춘 수가 유지되므로 이긴 쪽의 점수가 끝나는 순간 무너지지 않는다.
    expect(scoreOf(finished, HOST)).toBe(4)
  })

  it('관전 시점에는 감춘 숫자가 하나도 없다', () => {
    const view = toView(twoPlayerState(), null)
    for (const tiles of Object.values(view.hands)) {
      expect(tiles.every((tile) => tile.number === null)).toBe(true)
    }
  })

  it('표준 스물여섯 장이다 — 색마다 0~11과 조커 하나', () => {
    expect(DAVINCI_TILES).toHaveLength(DAVINCI_DECK_SIZE)
    expect(DAVINCI_TILES.filter((tile) => tile.number === DAVINCI_JOKER)).toHaveLength(2)
  })
})
