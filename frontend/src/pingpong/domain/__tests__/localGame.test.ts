import { describe, expect, it } from 'vitest'
import { IDEAL2, MISS1, SMASH_SPEED, W2_HI, W2_LO } from '@/pingpong/domain/court'
import { advanceLocalGame, createLocalGame, swingLocalGame } from '@/pingpong/domain/localGame'

const highRandom = () => 0.99

describe('local ping pong game', () => {
  it('tracks the incoming ball with the original gradual interpolation', () => {
    const game = createLocalGame('duo', 'normal', highRandom)

    advanceLocalGame(game, 100, 0.1, highRandom)

    expect(game.ball.x).toBeGreaterThan(0.5)
    expect(game.p1X).toBeGreaterThan(0.5)
    expect(game.p1X).toBeLessThan(game.ball.x)
    expect(game.p2X).toBe(0.5)
  })

  it('returns the ball automatically during a solo bot turn', () => {
    const game = createLocalGame('solo', 'normal', highRandom)
    game.ball.dir = -1
    game.ball.pos = 0.01
    game.ball.speed = 1

    advanceLocalGame(game, 200, 0.02, highRandom)

    expect(game.ball.dir).toBe(1)
    expect(game.p2SwingAt).toBe(200)
    expect(game.rally).toBe(1)
  })

  it('applies the original perfect-timing smash in local party mode', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.pos = 0.9
    game.ball.x = 0.65

    const feedback = swingLocalGame(game, 1, 300, false, highRandom)

    expect(feedback).toEqual({ kind: 'smash', text: '스매시! 💥' })
    expect(game.ball.dir).toBe(-1)
    expect(game.ball.speed).toBe(SMASH_SPEED)
    expect(game.p1X).toBe(0.65)
  })

  it('scores a missed return and starts the next serve after the countdown', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.pos = MISS1 - 0.01
    game.ball.speed = 1

    advanceLocalGame(game, 1_000, 0.02, highRandom)

    expect(game.s2).toBe(1)
    expect(game.phase).toBe('point')

    advanceLocalGame(game, 3_601, 0.02, highRandom)
    expect(game.phase).toBe('playing')
    expect(game.ball.dir).toBe(1)
    expect(game.ball.pos).toBe(0.02)
  })

  it('continues through deuce until one player leads by two points', () => {
    const game = createLocalGame('solo', 'normal', highRandom)
    game.s1 = 10
    game.s2 = 10
    game.ball.pos = MISS1 - 0.01
    game.ball.speed = 1

    advanceLocalGame(game, 1_000, 0.02, highRandom)

    expect(game.s2).toBe(11)
    expect(game.phase).toBe('point')

    game.phase = 'playing'
    game.ball.pos = MISS1 - 0.01
    advanceLocalGame(game, 2_000, 0.02, highRandom)

    expect(game.s2).toBe(12)
    expect(game.phase).toBe('over')
  })

  /**
   * 파티 모드의 **먼 쪽(P2)** 스윙. 가까운 쪽과 창(window)이 반대라 경계도 뒤집힌다 —
   * 여기가 비어 있으면 두 사람이 붙었을 때만 드러나는 판정 오류를 못 잡는다.
   */
  it('먼 쪽이 제때 휘두르면 공이 돌아간다', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.dir = -1
    game.ball.pos = IDEAL2
    game.ball.x = 0.4

    const feedback = swingLocalGame(game, 2, 300, false, highRandom)

    expect(feedback?.kind).not.toBe('miss')
    expect(game.ball.dir).toBe(1)
    expect(game.p2X).toBe(0.4)
  })

  it('먼 쪽이 너무 빠르거나 늦으면 놓친다', () => {
    const early = createLocalGame('duo', 'normal', highRandom)
    early.ball.dir = -1
    early.ball.pos = W2_HI + 0.01

    expect(swingLocalGame(early, 2, 300, false, highRandom)).toEqual({
      kind: 'miss',
      text: '너무 빨라요',
    })

    const late = createLocalGame('duo', 'normal', highRandom)
    late.ball.dir = -1
    late.ball.pos = W2_LO - 0.01

    expect(swingLocalGame(late, 2, 300, false, highRandom)).toEqual({
      kind: 'miss',
      text: '너무 늦었어요',
    })
  })

  it('혼자 하는 판에서는 먼 쪽 스윙이 무시된다 — 봇이 대신 친다', () => {
    const game = createLocalGame('solo', 'normal', highRandom)
    game.ball.dir = -1
    game.ball.pos = IDEAL2

    expect(swingLocalGame(game, 2, 300, false, highRandom)).toBeNull()
  })
})
