import { describe, expect, it } from 'vitest'
import { MISS1, SMASH_SPEED } from '../court'
import { advanceLocalGame, createLocalGame, swingLocalGame } from '../localGame'

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
})
