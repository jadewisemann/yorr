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

  /**
   * 폴트 공(아웃·네트)은 상대 라켓까지 가지 않는다. 아래 셋이 그 수명 전체다 —
   * 만들어지고, 떨어지며, 상대에게 점수를 준다.
   */
  it('이상점에서 멀리 벗어난 리턴은 폴트가 되고 상대가 점수를 얻는다', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.pos = 0.74
    game.ball.speed = 1

    // 0.74는 창(0.72~1.06) 안이지만 이상점(0.9)과 0.16 떨어져 이르게 친 폴트다.
    expect(swingLocalGame(game, 1, 300, false, highRandom)).toBeNull()
    expect(game.ball.fault).toBe('out')
    expect(game.ball.smash).toBe(false)

    // 폴트 공은 진행률이 끝에 닿는 순간 죽는다.
    let feedback = null
    for (let frame = 0; frame < 200 && feedback === null; frame += 1) {
      feedback = advanceLocalGame(game, 400 + frame * 16, 0.016, highRandom)
    }

    expect(feedback).toEqual({ kind: 'bad', text: '아웃! 🚀' })
    expect(game.s2).toBe(1)

    // 득점 뒤의 카운트다운 동안 폴트 공은 바닥으로 떨어진다.
    advanceLocalGame(game, 4_000, 0.016, highRandom)
    expect(game.ball.fall).toBeGreaterThan(0)
  })

  it('폴트 공이 나는 동안의 스윙과 국면 밖 스윙은 무시된다', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.pos = 0.74
    game.ball.speed = 1
    swingLocalGame(game, 1, 300, false, highRandom)

    expect(swingLocalGame(game, 2, 400, false, highRandom)).toBeNull()

    game.phase = 'over'
    expect(swingLocalGame(game, 1, 500, false, highRandom)).toBeNull()
  })

  it('되받아친 직후의 연타는 잠금 시간 안에서 무시된다', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.pos = 0.9

    expect(swingLocalGame(game, 1, 300, false, highRandom)).not.toBeNull()
    // 같은 라켓을 260ms 안에 다시 휘두르는 것은 손가락 연타다.
    expect(swingLocalGame(game, 1, 400, false, highRandom)).toBeNull()
  })

  it('공이 가는 쪽 라켓만 칠 수 있다', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.dir = -1
    game.ball.pos = 0.5

    expect(swingLocalGame(game, 1, 300, false, highRandom)).toBeNull()
  })

  it('1번이 너무 늦게 휘두르면 놓친다', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.pos = 1.07

    expect(swingLocalGame(game, 1, 300, false, highRandom)).toEqual({
      kind: 'miss',
      text: '너무 늦었어요',
    })
  })

  it('둘이 하는 판에서 2번이 놓치면 1번이 점수를 얻는다', () => {
    const game = createLocalGame('duo', 'normal', highRandom)
    game.ball.dir = -1
    game.ball.pos = -0.09
    game.ball.speed = 1

    advanceLocalGame(game, 200, 0.02, highRandom)

    expect(game.s1).toBe(1)
    expect(game.phase).toBe('point')
    // 둘이 하는 판은 득점한 쪽의 반대편이 다음 서브를 받는다.
    expect(game.serveReceiver).toBe(2)

    // 2번에게 가는 서브는 반대쪽 끝에서 출발한다.
    advanceLocalGame(game, 3_000, 0.016, highRandom)
    expect(game.phase).toBe('playing')
    expect(game.ball.dir).toBe(-1)
    expect(game.ball.pos).toBeLessThan(1)
  })

  it('봇이 실수하면 그 자리에서 점수를 주거나 폴트 공을 넘긴다', () => {
    // 0.05는 봇의 실수 확률(0.07) 안이고, 두 번째 난수가 0.5 미만이라 즉시 실점이다.
    const missing = createLocalGame('solo', 'normal', () => 0.05)
    missing.ball.dir = -1
    missing.ball.pos = 0.01
    missing.ball.speed = 1

    expect(advanceLocalGame(missing, 200, 0.02, () => 0.05)).toEqual({
      kind: 'good',
      text: '득점!',
    })
    expect(missing.s1).toBe(1)

    // 두 번째 난수가 0.5 이상이면 폴트 공으로 넘긴다.
    const faulting = createLocalGame('solo', 'normal', () => 0.06)
    faulting.ball.dir = -1
    faulting.ball.pos = 0.01
    faulting.ball.speed = 1
    const sequence = [0.06, 0.9, 0.9, 0.9]
    let index = 0
    const scripted = () => sequence[index++ % sequence.length] ?? 0.9

    expect(advanceLocalGame(faulting, 200, 0.02, scripted)).toBeNull()
    expect(faulting.ball.fault).toBe('net')
    expect(faulting.ball.dir).toBe(1)
  })

  it('봇도 스매시를 친다 — 화면이 그때 흔들린다', () => {
    // 첫 난수는 실수 판정(0.5 ≥ 0.07이라 통과), 두 번째가 스매시 판정(0.1 < 0.3)이다.
    const sequence = [0.5, 0.1, 0.5, 0.5]
    let index = 0
    const scripted = () => sequence[index++ % sequence.length] ?? 0.5
    const game = createLocalGame('solo', 'normal', highRandom)
    game.ball.dir = -1
    game.ball.pos = 0.01
    game.ball.speed = 1

    advanceLocalGame(game, 200, 0.02, scripted)

    expect(game.ball.smash).toBe(true)
    expect(game.shakeAt).toBe(200)
  })
})
