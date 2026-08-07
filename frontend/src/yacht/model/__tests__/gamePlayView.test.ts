import { describe, expect, it } from 'vitest'
import type { GameState, Player } from '@/realtime/wsEvents'
import type { DiceSet } from '@/yacht/domain/dice'
import { buildGamePlayView } from '@/yacht/model/gamePlayView'

const ME = 'me'
const RIVAL = 'rival'

const players = [
  { nickname: '상대', playerId: RIVAL, status: 'connected' },
  { nickname: '나', playerId: ME, status: 'connected' },
] as unknown as Player[]

function gameWith(overrides: Partial<GameState> = {}) {
  return {
    activePlayerId: ME,
    roundNumber: 1,
    scores: {
      [ME]: { categories: { ones: 3 }, total: 3 },
      [RIVAL]: { categories: {}, total: 0 },
    },
    turnOrder: [ME, RIVAL],
    ...overrides,
  } as unknown as GameState
}

const build = (dice: DiceSet | null, game = gameWith(), leverageCategory = null) =>
  buildGamePlayView({ dice, game, leverageCategory, players, you: ME })

describe('buildGamePlayView', () => {
  it('아직 안 굴렸으면 미리보기 점수가 없다', () => {
    const view = build(null)

    expect(view.rolled).toBe(false)
    expect(view.candidates).toEqual({})
  })

  it('기록된 족보는 열린 목록에서 빠지고 후보 계산에서도 제외된다', () => {
    const view = build([1, 1, 1, 2, 3] as DiceSet)

    expect(view.openCategories).not.toContain('ones')
    expect(view.candidates.ones).toBeUndefined()
    expect(view.candidates.threes).toBeDefined()
  })

  it('레버리지 족보는 미리보기부터 2배다', () => {
    const plain = build([3, 3, 3, 1, 2] as DiceSet)
    const doubled = buildGamePlayView({
      dice: [3, 3, 3, 1, 2] as DiceSet,
      game: gameWith(),
      leverageCategory: 'threes',
      players,
      you: ME,
    })

    expect(doubled.candidates.threes).toBe((plain.candidates.threes ?? 0) * 2)
  })

  it('점수표와 턴 띠가 서로 다른 순서를 쓴다', () => {
    const view = build(null, gameWith({ turnOrder: [RIVAL, ME] }))

    expect(view.sheetPlayers[0]?.playerId).toBe(ME)
    expect(view.turnPlayers[0]?.playerId).toBe(RIVAL)
  })

  it('활성 플레이어를 명단에서 찾아 준다', () => {
    expect(build(null).activePlayer?.nickname).toBe('나')
    expect(build(null, gameWith({ activePlayerId: RIVAL })).activePlayer?.nickname).toBe('상대')
  })
})
