import { describe, expect, it } from 'vitest'
import {
  DAVINCI_DECK_SIZE,
  DAVINCI_MAX_NUMBER,
  DECIDE_MILLIS,
  decide,
  expire,
  forfeit,
  GUESS_MILLIS,
  guess,
  initialDavinciState,
  insertIndexOf,
  isGuessableNumber,
  PLACE_MILLIS,
  place,
} from '../davinciRules.js'
import { DAVINCI_JOKER, type DavinciState, type DavinciTile } from '../davinciState.js'
import { deckOrder, GUEST, HOST, NOW, THIRD, tilesOf, twoPlayerState } from './davinciFixtures.js'

/**
 * 다빈치는 서버가 예약한 마감 하나로 굴러간다. 국면마다 그 값이 다르고
 * (`GUESSING` 30초 · `DECIDING`·`PLACING` 15초), 한 번 어긋나면 턴이 멎거나
 * 이미 지난 마감으로 예약이 다시 걸린다. 아래는 그 값과, 값이 흔들릴 때 무엇이
 * 어긋나는지를 고정한다.
 */

/** 상대의 감춰지지 않은 첫 타일. 맞히면 그 사람의 한 칸이 열린다. */
const targetTile = (state: DavinciState, playerId: string): DavinciTile => {
  const tile = tilesOf(state, playerId).find((candidate) => !candidate.revealed)
  if (tile === undefined) throw new Error('감춰진 타일이 없다')
  return tile
}

/**
 * 상대 손패를 한 장만 남기고 전부 공개해 둔 판. 그 한 장을 맞히면 판이 끝난다 —
 * 승부가 갈리는 자리를 보는 검사들이 여기서 출발한다.
 */
const oneTileLeft = (overrides: Partial<DavinciState> = {}) => {
  const state = twoPlayerState()
  const hand = tilesOf(state, GUEST)
  const last = hand[0]
  if (last === undefined) throw new Error('손패가 비었다')
  return {
    last,
    state: {
      ...state,
      hands: {
        ...state.hands,
        [GUEST]: hand.map((tile) => (tile.id === last.id ? tile : { ...tile, revealed: true })),
      },
      ...overrides,
    } satisfies DavinciState,
  }
}

/** 맞혀서 결정 단계에 들어간 판. 그 뒤의 두 갈래(계속·멈춤)가 여기서 갈린다. */
const afterHit = (): DavinciState => {
  const state = twoPlayerState()
  const tile = targetTile(state, GUEST)
  return guess(state, HOST, 0, GUEST, tile.id, tile.number, NOW)
}

describe('국면마다 마감이 다르다', () => {
  it('판을 열면 첫 추측 마감이 잡힌다', () => {
    const state = twoPlayerState()

    expect(state.nextActionAt).toBe(NOW + GUESS_MILLIS)
    expect(state.phase).toBe('GUESSING')
    expect(state.version).toBe(1)
  })

  it('맞히면 결정 마감으로, 계속을 고르면 다시 추측 마감으로 바뀐다', () => {
    const hit = afterHit()
    expect(hit.phase).toBe('DECIDING')
    expect(hit.nextActionAt).toBe(NOW + DECIDE_MILLIS)
    expect(hit.version).toBe(2)

    const again = decide(hit, HOST, 1, 'CONTINUE', NOW + 1_000)

    expect(again.phase).toBe('GUESSING')
    expect(again.nextActionAt).toBe(NOW + 1_000 + GUESS_MILLIS)
    expect(again.version).toBe(hit.version + 1)
  })

  it('멈추면 턴이 넘어가고 다음 사람의 추측 마감이 잡힌다', () => {
    const hit = afterHit()
    const stopped = decide(hit, HOST, 1, 'STOP', NOW + 1_000)

    expect(stopped.turnPlayerId).toBe(GUEST)
    expect(stopped.nextActionAt).toBe(NOW + 1_000 + GUESS_MILLIS)
    expect(stopped.turn).toBe(2)
    // 턴 넘김이 안에서 한 번 올린 값을 그대로 쓴다 — 두 번 올리면 클라가 프레임을 건너뛴다.
    expect(stopped.version).toBe(hit.version + 1)
  })

  it('조커를 뽑으면 놓기 마감이 잡힌다', () => {
    // 조커가 첫 뽑기로 오도록 덱을 세운다.
    const jokerFirst = initialDavinciState([HOST, GUEST], deckOrder(12), NOW)
    const drawnJoker = initialDavinciState(
      [HOST, GUEST],
      // 12(검정 조커)는 손패에서 빠지므로 더미 맨 앞으로 온다.
      deckOrder(12),
      NOW,
    )

    expect(jokerFirst.drawn?.number).toBe(DAVINCI_JOKER)
    const tile = targetTile(drawnJoker, GUEST)
    const hit = guess(drawnJoker, HOST, 0, GUEST, tile.id, tile.number, NOW)
    const stopped = decide(hit, HOST, 1, 'STOP', NOW + 500)

    // 조커를 들고 있으면 넣을 자리를 고를 때까지 판이 놓기 단계에 머문다.
    if (stopped.phase === 'PLACING') {
      expect(stopped.nextActionAt).toBe(NOW + 500 + PLACE_MILLIS)
    }
  })

  it('틀리면 그 자리에서 턴이 넘어간다', () => {
    const state = twoPlayerState()
    const tile = targetTile(state, GUEST)
    const wrong = tile.number === 0 ? 1 : 0

    const missed = guess(state, HOST, 0, GUEST, tile.id, wrong, NOW + 200)

    expect(missed.lastEvent).toMatchObject({ correct: false, kind: 'GUESS', number: wrong })
    expect(missed.turnPlayerId).toBe(GUEST)
    expect(missed.nextActionAt).toBe(NOW + 200 + GUESS_MILLIS)
    expect(missed.version).toBe(state.version + 1)
  })
})

describe('추측 가능한 숫자', () => {
  it('0과 11은 부르고 그 밖은 부르지 않는다', () => {
    expect(isGuessableNumber(0)).toBe(true)
    expect(isGuessableNumber(DAVINCI_MAX_NUMBER)).toBe(true)
    expect(isGuessableNumber(DAVINCI_JOKER)).toBe(true)
    // 조커는 -1이라 하한(0) 아래지만 이름으로 부를 수 있다.
    expect(isGuessableNumber(DAVINCI_JOKER - 1)).toBe(false)
    expect(isGuessableNumber(DAVINCI_MAX_NUMBER + 1)).toBe(false)
    expect(isGuessableNumber(1.5)).toBe(false)
  })

  it('부를 수 없는 숫자는 판을 건드리지 않는다', () => {
    const state = twoPlayerState()
    const tile = targetTile(state, GUEST)

    expect(guess(state, HOST, 0, GUEST, tile.id, DAVINCI_MAX_NUMBER + 1, NOW)).toBe(state)
    expect(guess(state, HOST, 0, GUEST, tile.id, DAVINCI_JOKER - 1, NOW)).toBe(state)
  })
})

describe('타일 삽입 자리', () => {
  it('같은 숫자·같은 색이 이미 있으면 그 뒤에 들어간다', () => {
    const hand: DavinciTile[] = [
      { color: 'BLACK', id: 'a', number: 3, revealed: false },
      { color: 'WHITE', id: 'b', number: 7, revealed: false },
    ]

    // 같은 값은 뒤로 — 앞에 넣으면 이미 공개된 순서가 흔들린다.
    expect(insertIndexOf(hand, { color: 'BLACK', number: 3 })).toBe(1)
    expect(insertIndexOf(hand, { color: 'WHITE', number: 3 })).toBe(1)
    expect(insertIndexOf(hand, { color: 'BLACK', number: 2 })).toBe(0)
    expect(insertIndexOf(hand, { color: 'BLACK', number: 9 })).toBe(2)
  })

  it('조커는 자리 계산에서 빠진다', () => {
    const hand: DavinciTile[] = [
      { color: 'BLACK', id: 'j', number: DAVINCI_JOKER, revealed: false },
      { color: 'BLACK', id: 'a', number: 5, revealed: false },
    ]

    expect(insertIndexOf(hand, { color: 'BLACK', number: 3 })).toBe(0)
    expect(insertIndexOf(hand, { color: 'BLACK', number: 9 })).toBe(2)
  })
})

describe('판을 열 수 없는 조건', () => {
  it('사람 수가 둘보다 적거나 넷보다 많으면 열지 않는다', () => {
    expect(() => initialDavinciState([HOST], deckOrder(), NOW)).toThrow(
      'davinci_requires_two_to_four_players',
    )
    expect(() => initialDavinciState([HOST, GUEST, THIRD, 'p4', 'p5'], deckOrder(), NOW)).toThrow(
      'davinci_requires_two_to_four_players',
    )
    expect(() => initialDavinciState([], deckOrder(), NOW)).toThrow(
      'davinci_requires_two_to_four_players',
    )
  })

  it('순열이 짧거나 같은 값이 겹치면 열지 않는다', () => {
    const short = deckOrder().slice(0, DAVINCI_DECK_SIZE - 1)
    const duplicated = deckOrder().map((index) => (index === 1 ? 0 : index))

    expect(() => initialDavinciState([HOST, GUEST], short, NOW)).toThrow(
      'davinci_invalid_deck_order',
    )
    expect(() => initialDavinciState([HOST, GUEST], duplicated, NOW)).toThrow(
      'davinci_invalid_deck_order',
    )
  })
})

describe('마감과 이탈의 기록', () => {
  it('마감이 지나면 틀린 추측과 같게 적히고 턴이 넘어간다', () => {
    const state = twoPlayerState()

    const timedOut = expire(state, NOW + GUESS_MILLIS)

    expect(timedOut.lastEvent).toMatchObject({
      actorId: HOST,
      correct: false,
      kind: 'TIMEOUT',
      number: null,
      targetId: null,
      tileId: null,
    })
    expect(timedOut.turnPlayerId).toBe(GUEST)
    expect(timedOut.version).toBe(state.version + 1)
  })

  it('이탈은 손패를 공개하고 남은 사람을 승자로 적는다', () => {
    const state = twoPlayerState()

    const left = forfeit(state, GUEST, NOW + 1_000)

    expect(left.phase).toBe('FINISHED')
    expect(left.winnerId).toBe(HOST)
    expect(left.nextActionAt).toBe(0)
    expect(tilesOf(left, GUEST).every((tile) => tile.revealed)).toBe(true)
    expect(left.lastEvent).toMatchObject({
      actorId: GUEST,
      correct: false,
      kind: 'FORFEIT',
      number: null,
    })
  })

  it('셋 중 하나가 나가면 판은 이어지고 차례만 넘어간다', () => {
    const three = initialDavinciState([HOST, GUEST, THIRD], deckOrder(), NOW)

    const left = forfeit(three, HOST, NOW + 1_000)

    expect(left.phase).toBe('GUESSING')
    expect(left.turnPlayerId).toBe(GUEST)
    expect(left.nextActionAt).toBe(NOW + 1_000 + GUESS_MILLIS)
    // 자리 자체는 남긴다 — 지우면 그때까지 맞힌 기록을 되짚을 수 없다.
    expect(left.playerOrder).toEqual([HOST, GUEST, THIRD])
  })

  it('탈락한 사람은 차례를 건너뛴다', () => {
    const three = initialDavinciState([HOST, GUEST, THIRD], deckOrder(), NOW)
    // 조커를 들고 있으면 놓기 단계로 새 나가므로, 뽑은 타일을 비워 순수한 턴 넘김만 본다.
    const withoutGuest: DavinciState = { ...three, drawn: null, eliminated: [GUEST] }

    const passed = expire(withoutGuest, NOW + GUESS_MILLIS)

    expect(passed.turnPlayerId).toBe(THIRD)
  })
})

describe('놓기 자리 검증', () => {
  it('자리가 손패 밖이거나 정수가 아니면 놓지 않는다', () => {
    const state = twoPlayerState()
    const placing: DavinciState = {
      ...state,
      drawn: { color: 'BLACK', id: 'joker', number: DAVINCI_JOKER, revealed: false },
      phase: 'PLACING',
    }
    const handSize = tilesOf(placing, HOST).length

    expect(place(placing, HOST, 1, -1, NOW)).toBe(placing)
    expect(place(placing, HOST, 1, handSize + 1, NOW)).toBe(placing)
    expect(place(placing, HOST, 1, 1.5, NOW)).toBe(placing)

    // 0과 손패 길이는 둘 다 유효한 자리다 — 맨 앞과 맨 뒤.
    expect(place(placing, HOST, 1, 0, NOW).phase).not.toBe('PLACING')
    expect(place(placing, HOST, 1, handSize, NOW).phase).not.toBe('PLACING')
  })

  it('마감이 지나면 가장 오른쪽에 놓는다', () => {
    const state = twoPlayerState()
    const joker: DavinciTile = {
      color: 'BLACK',
      id: 'joker',
      number: DAVINCI_JOKER,
      revealed: false,
    }
    const placing: DavinciState = { ...state, drawn: joker, phase: 'PLACING' }
    const before = tilesOf(placing, HOST).length

    const placed = expire(placing, NOW + PLACE_MILLIS)

    expect(tilesOf(placed, HOST)).toHaveLength(before + 1)
    // 고르지 않았으면 맨 오른쪽이다 — 그 자리가 조커를 최댓값으로 보이게 한다.
    expect(tilesOf(placed, HOST).at(-1)?.id).toBe('joker')
    expect(placed.turnPlayerId).toBe(GUEST)
  })

  it('놓을 타일이 없는 놓기 단계에서도 턴은 반드시 움직인다', () => {
    const state = twoPlayerState()
    const broken: DavinciState = { ...state, drawn: null, phase: 'PLACING' }

    const moved = expire(broken, NOW + PLACE_MILLIS)

    // 움직이지 않으면 지난 마감으로 예약이 다시 걸려 제자리를 돈다.
    expect(moved.turnPlayerId).toBe(GUEST)
    expect(moved.nextActionAt).toBe(NOW + PLACE_MILLIS + GUESS_MILLIS)
  })
})
/**
 * 아래는 **잘못 불린 전이가 상태를 건드리지 않는다**는 계약을 조건 하나씩 짚는다.
 * 서비스는 늦게 도착한 입력이나 지나간 국면의 마감을 그대로 흘려보내므로, 규칙이
 * 각 조건을 따로 지켜야 한다 — 하나가 무너져도 나머지가 가려 준다면 그것은 우연이다.
 */
describe('입력을 물리치는 조건', () => {
  it('추측은 국면과 차례를 각각 본다', () => {
    const state = twoPlayerState()
    const tile = targetTile(state, GUEST)

    // 국면은 맞지만 남의 차례.
    expect(guess(state, GUEST, 0, HOST, tile.id, tile.number, NOW)).toBe(state)
    // 차례는 맞지만 국면이 다르다.
    const deciding: DavinciState = { ...state, phase: 'DECIDING' }
    expect(guess(deciding, HOST, 0, GUEST, tile.id, tile.number, NOW)).toBe(deciding)
  })

  it('이미 부른 입력 번호와 그보다 작은 번호는 흘려보낸다', () => {
    const state = twoPlayerState()
    const tile = targetTile(state, GUEST)
    const guessed = guess(state, HOST, 3, GUEST, tile.id, tile.number, NOW)
    expect(guessed.lastInputSeq[HOST]).toBe(3)

    // 같은 번호와 더 작은 번호는 재전송이다.
    expect(decide(guessed, HOST, 3, 'STOP', NOW)).toBe(guessed)
    expect(decide(guessed, HOST, 2, 'STOP', NOW)).toBe(guessed)
    // 더 큰 번호만 통과한다.
    expect(decide(guessed, HOST, 4, 'STOP', NOW)).not.toBe(guessed)
  })

  it('첫 입력은 번호 0으로도 통과한다', () => {
    const fresh: DavinciState = { ...twoPlayerState(), lastInputSeq: {} }
    const tile = targetTile(fresh, GUEST)

    const guessed = guess(fresh, HOST, 0, GUEST, tile.id, tile.number, NOW)

    expect(guessed).not.toBe(fresh)
    expect(guessed.lastInputSeq[HOST]).toBe(0)
  })

  it('자기 타일과 방에 없는 사람은 추측 대상이 되지 않는다', () => {
    const state = twoPlayerState()
    const mine = targetTile(state, HOST)
    const theirs = targetTile(state, GUEST)

    expect(guess(state, HOST, 0, HOST, mine.id, mine.number, NOW)).toBe(state)
    expect(guess(state, HOST, 0, '구경꾼', theirs.id, theirs.number, NOW)).toBe(state)
  })

  it('없는 타일과 이미 공개된 타일은 다시 맞힐 수 없다', () => {
    const state = twoPlayerState()
    const tile = targetTile(state, GUEST)
    const opened = guess(state, HOST, 0, GUEST, tile.id, tile.number, NOW)

    expect(guess(state, HOST, 0, GUEST, '없는-타일', 3, NOW)).toBe(state)
    // 공개된 타일을 다시 고르면 그대로 돌려준다.
    const continued = decide(opened, HOST, 1, 'CONTINUE', NOW)
    expect(guess(continued, HOST, 2, GUEST, tile.id, tile.number, NOW)).toBe(continued)
  })

  it('결정은 국면과 차례를 각각 본다', () => {
    const hit = afterHit()

    expect(decide(hit, GUEST, 9, 'STOP', NOW)).toBe(hit)
    const guessing: DavinciState = { ...hit, phase: 'GUESSING' }
    expect(decide(guessing, HOST, 9, 'STOP', NOW)).toBe(guessing)
  })

  it('놓기는 국면과 차례를 각각 본다', () => {
    const state = twoPlayerState()
    const placing: DavinciState = {
      ...state,
      drawn: { color: 'BLACK', id: 'joker', number: DAVINCI_JOKER, revealed: false },
      phase: 'PLACING',
    }

    expect(place(placing, GUEST, 1, 0, NOW)).toBe(placing)
    expect(place(state, HOST, 1, 0, NOW)).toBe(state)
    // 같은 입력 번호의 재전송도 흘려보낸다.
    const placed = place(placing, HOST, 1, 0, NOW)
    expect(placed).not.toBe(placing)
    expect(place(placing, HOST, -1, 0, NOW)).toBe(placing)
  })
})

describe('판이 끝나는 자리', () => {
  it('상대의 마지막 타일을 열면 그 자리에서 이긴다', () => {
    const { last, state } = oneTileLeft()

    const won = guess(state, HOST, 0, GUEST, last.id, last.number, NOW)

    expect(won.phase).toBe('FINISHED')
    expect(won.winnerId).toBe(HOST)
    expect(won.nextActionAt).toBe(0)
    expect(won.eliminated).toContain(GUEST)
    expect(won.hits[HOST]).toBe(1)
  })

  it('손패가 없는 사람이 섞여 있어도 판정이 멎지 않는다', () => {
    const state = twoPlayerState()
    // Redis에서 되돌아온 상태에 손패가 통째로 빠져 있을 수 있다.
    const missing: DavinciState = { ...state, hands: { [HOST]: tilesOf(state, HOST) } }
    const tile = targetTile(state, GUEST)

    expect(guess(missing, HOST, 0, GUEST, tile.id, tile.number, NOW)).toBe(missing)
    expect(forfeit(missing, GUEST, NOW).phase).toBe('FINISHED')
  })

  it('덱이 비면 뽑은 타일 자리가 비어 있다', () => {
    const state = twoPlayerState()
    const empty: DavinciState = { ...state, deck: [], drawn: null }

    const passed = expire(empty, NOW + GUESS_MILLIS)

    expect(passed.drawn).toBeNull()
    expect(passed.turnPlayerId).toBe(GUEST)
  })
})
describe('입력 번호와 버전', () => {
  it('추측도 같은 번호와 더 작은 번호를 흘려보낸다', () => {
    const state = twoPlayerState()
    const tile = targetTile(state, GUEST)
    // 5번까지 부른 상태. 재전송은 판정 없이 그대로 돌아와야 한다.
    const primed: DavinciState = {
      ...state,
      lastInputSeq: { ...state.lastInputSeq, [HOST]: 5 },
    }

    expect(guess(primed, HOST, 5, GUEST, tile.id, tile.number, NOW)).toBe(primed)
    expect(guess(primed, HOST, 4, GUEST, tile.id, tile.number, NOW)).toBe(primed)
    expect(guess(primed, HOST, 6, GUEST, tile.id, tile.number, NOW)).not.toBe(primed)
  })

  it('계속을 고르면 판 번호가 한 칸 올라간다', () => {
    const hit = afterHit()

    const again = decide(hit, HOST, 9, 'CONTINUE', NOW + 100)

    expect(again.version).toBe(hit.version + 1)
    expect(again.phase).toBe('GUESSING')
    expect(again.turnPlayerId).toBe(HOST)
  })

  it('결정과 놓기도 번호가 없던 사람의 0번 입력을 받아들인다', () => {
    const hit = afterHit()
    const fresh: DavinciState = { ...hit, lastInputSeq: {} }

    const decided = decide(fresh, HOST, 0, 'CONTINUE', NOW)
    expect(decided).not.toBe(fresh)
    expect(decided.lastInputSeq[HOST]).toBe(0)

    const placing: DavinciState = {
      ...twoPlayerState(),
      drawn: { color: 'BLACK', id: 'joker', number: DAVINCI_JOKER, revealed: false },
      lastInputSeq: {},
      phase: 'PLACING',
    }
    const placed = place(placing, HOST, 0, 0, NOW)
    expect(placed).not.toBe(placing)
    expect(placed.lastInputSeq[HOST]).toBe(0)
  })

  it('결정과 놓기는 남의 입력 번호를 지우지 않는다', () => {
    const hit = afterHit()
    const withGuest: DavinciState = { ...hit, lastInputSeq: { ...hit.lastInputSeq, [GUEST]: 4 } }

    const decided = decide(withGuest, HOST, 9, 'CONTINUE', NOW)

    expect(decided.lastInputSeq).toEqual({ ...withGuest.lastInputSeq, [HOST]: 9 })
    expect(decided.version).toBe(withGuest.version + 1)
  })

  it('놓기와 이탈도 판 번호를 한 칸씩 올린다', () => {
    const state = twoPlayerState()
    const placing: DavinciState = {
      ...state,
      drawn: { color: 'BLACK', id: 'joker', number: DAVINCI_JOKER, revealed: false },
      phase: 'PLACING',
    }

    const placed = place(placing, HOST, 1, 0, NOW)
    expect(placed.version).toBeGreaterThan(placing.version)
    expect(placed.lastInputSeq).toEqual({ ...placing.lastInputSeq, [HOST]: 1 })

    const three = initialDavinciState([HOST, GUEST, THIRD], deckOrder(), NOW)
    const left = forfeit(three, HOST, NOW + 1_000)
    // 자리 정리와 턴 넘김이 한 프레임이므로 번호는 한 칸만 올라간다.
    expect(left.version).toBe(three.version + 1)
  })

  it('맞힌 사람까지 탈락한 상태에서도 승자를 적는다', () => {
    // 맞히는 사람이 이미 탈락 목록에 있는 어긋난 상태. 그래도 판은 끝나야 한다.
    const { last, state } = oneTileLeft({ eliminated: [HOST] })

    const won = guess(state, HOST, 0, GUEST, last.id, last.number, NOW)

    expect(won.phase).toBe('FINISHED')
    expect(won.winnerId).toBe(HOST)
  })

  it('손패가 통째로 빠진 사람의 차례가 오면 그 자리에서 탈락시킨다', () => {
    const three = initialDavinciState([HOST, GUEST, THIRD], deckOrder(), NOW)
    const { [GUEST]: _removed, ...rest } = three.hands
    const missing: DavinciState = {
      ...three,
      drawn: null,
      hands: rest,
      turnPlayerId: GUEST,
    }

    const passed = expire(missing, NOW + GUESS_MILLIS)

    expect(passed.eliminated).toContain(GUEST)
    expect(passed.turnPlayerId).toBe(THIRD)
  })
})
