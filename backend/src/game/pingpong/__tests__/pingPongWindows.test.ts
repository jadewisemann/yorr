import { describe, expect, it } from 'vitest'
import {
  expire,
  faultOf,
  forfeit,
  initial,
  NORMAL_SPEED,
  PING_PONG_WINDOWS,
  POINT_COUNTDOWN_MILLIS,
  ready,
  serve,
  serveReceiver,
  swing,
} from '../pingPongRules.js'
import type { PingPongState } from '../pingPongState.js'
import { P1, P2, rallyState } from './pingPongFixtures.js'

/**
 * 판정 창의 **값 자체가 계약**이다. 프론트의 3D 무대가 같은 좌표계로 공을 그리고
 * (`frontend/src/pingpong/`), 클라이언트는 서버 프레임 없이 이 숫자만으로 공의
 * 위치를 복원한다. 그래서 여기서는 상수를 다시 적어 고정한다 — 규칙 파일에서
 * 값을 읽어 비교하면 값이 바뀐 날 검사가 조용히 따라가 버린다.
 */
const W = PING_PONG_WINDOWS

describe('창의 좌표', () => {
  it('0번 자리의 창은 이 값들이다', () => {
    expect(W.ideal1).toBe(0.9)
    expect(W.window1Low).toBe(0.72)
    expect(W.window1High).toBe(1.06)
    expect(W.miss1).toBe(1.1)
  })

  it('1번 자리의 창은 0번을 1에서 뺀 거울상이다', () => {
    // 미러가 깨지면 한쪽만 유리해진다 — 뺄셈 방향 자체가 계약이다.
    expect(W.ideal2).toBeCloseTo(0.1, 10)
    expect(W.window2Low).toBeCloseTo(-0.06, 10)
    expect(W.window2High).toBeCloseTo(0.28, 10)
    expect(W.miss2).toBeCloseTo(-0.1, 10)

    expect(W.ideal1 + W.ideal2).toBeCloseTo(1, 10)
    expect(W.window1Low + W.window2High).toBeCloseTo(1, 10)
    expect(W.window1High + W.window2Low).toBeCloseTo(1, 10)
    expect(W.miss1 + W.miss2).toBeCloseTo(1, 10)
  })

  it('등급과 폴트의 문턱도 값이 계약이다', () => {
    expect(W.perfectDistance).toBe(0.06)
    expect(W.goodDistance).toBe(0.1)
    expect(W.faultBand).toBe(0.04)
    expect(W.smashSpeed).toBe(1.95)
    expect(W.weakSpeed).toBe(0.82)
    expect(NORMAL_SPEED).toBe(1)
  })
})

describe('등급 경계는 거리와 같을 때도 포함이다', () => {
  const kindAt = (distance: number) =>
    swing(rallyState({ pos: W.ideal1 - distance }), P1, 0, 1_000, 0.5).lastEvent?.type

  it('완벽 거리와 같으면 아직 스매시다', () => {
    expect(kindAt(0.06)).toBe('SMASH')
    expect(kindAt(0.061)).toBe('NICE')
  })

  it('좋음 거리와 같으면 아직 NICE다', () => {
    expect(kindAt(0.1)).toBe('NICE')
    expect(kindAt(0.101)).toBe('OK')
  })

  it('폴트 여유와 같으면 아직 폴트가 아니다', () => {
    // 이른 쪽 여유 = 0.9 - 0.72 - 0.04 = 0.14.
    expect(kindAt(0.14)).toBe('OK')
    expect(kindAt(0.141)).toBe('OUT')
    // 늦은 쪽 여유 = 1.06 - 0.9 - 0.04 = 0.12.
    expect(kindAt(-0.12)).toBe('OK')
    expect(kindAt(-0.121)).toBe('NET')
  })

  it('평범한 리턴은 스매시로 적히지 않는다', () => {
    const ok = swing(rallyState({ pos: W.ideal1 - 0.14 }), P1, 0, 1_000, 0.5)

    expect(ok.ball.smash).toBe(false)
    expect(ok.ball.speed).toBe(W.weakSpeed)
  })
})

describe('진행률과 방향', () => {
  it('폴트 지점은 진행률로 적히고 방향에 따라 뒤집힌다', () => {
    const fromP1 = swing(rallyState({ pos: W.window1High }), P1, 0, 1_000, 0.5)
    // P1이 친 공은 -1 방향으로 가므로 진행률은 1 - pos다.
    expect(fromP1.ball.direction).toBe(-1)
    expect(fromP1.ball.faultFrom).toBeCloseTo(1 - W.window1High, 10)

    const fromP2 = swing(rallyState({ direction: -1, pos: W.window2Low }), P2, 0, 1_000, 0.5)
    expect(fromP2.ball.direction).toBe(1)
    expect(fromP2.ball.faultFrom).toBeCloseTo(W.window2Low, 10)
  })

  it('내게 오는 공이 아니면 입력 번호만 남는다', () => {
    // P1에게 오는 공(+1)을 P2가 친다.
    const wrongWay = swing(rallyState({ pos: 0.5 }), P2, 3, 1_000, 0.5)

    expect(wrongWay.lastInputSeq[P2]).toBe(3)
    expect(wrongWay.ball.direction).toBe(1)
    expect(wrongWay.version).toBe(6)
    expect(wrongWay.lastEvent).toBeUndefined()
  })

  it('P2에게 가는 공은 P2만 칠 수 있다', () => {
    const toP2 = rallyState({ direction: -1, pos: W.ideal2 })

    expect(swing(toP2, P1, 0, 1_000, 0.5).ball.direction).toBe(-1)
    expect(swing(toP2, P2, 0, 1_000, 0.5).ball.direction).toBe(1)
  })
})

describe('스윙을 흘려보내는 갈래', () => {
  it('방에 없는 사람의 스윙은 상태를 건드리지 않는다', () => {
    const state = rallyState()

    expect(swing(state, '구경꾼', 0, 1_000, 0.5)).toBe(state)
  })

  it('입력 번호가 없던 사람의 0번 스윙은 받아들인다', () => {
    const fresh: PingPongState = { ...rallyState({ pos: W.ideal1 }), lastInputSeq: {} }

    const swung = swing(fresh, P1, 0, 1_000, 0.5)

    expect(swung.lastEvent?.type).toBe('SMASH')
    expect(swung.lastInputSeq[P1]).toBe(0)
  })

  it('카운트다운과 끝난 판의 스윙은 번호만 남긴다', () => {
    const counting: PingPongState = { ...rallyState(), phase: 'COUNTDOWN' }
    const finished: PingPongState = { ...rallyState(), phase: 'FINISHED' }

    expect(swing(counting, P1, 1, 1_000, 0.5)).toMatchObject({
      lastInputSeq: { [P1]: 1 },
      phase: 'COUNTDOWN',
      version: 6,
    })
    expect(swing(finished, P1, 1, 1_000, 0.5).phase).toBe('FINISHED')
  })

  it('폴트 공이 날아가는 중에는 칠 수 없다', () => {
    const flying = rallyState({ fault: 'NET', pos: W.ideal1 })

    const swung = swing(flying, P1, 1, 1_000, 0.5)

    expect(swung.ball.direction).toBe(1)
    expect(swung.lastInputSeq[P1]).toBe(1)
  })
})

describe('판을 여는 자리', () => {
  it('두 사람이 아니면 판을 열지 않는다', () => {
    expect(() => initial([P1], 1_000)).toThrow('ping_pong_requires_two_players')
    expect(() => initial([P1, P2, 'p3'], 1_000)).toThrow('ping_pong_requires_two_players')
  })

  it('처음 공은 멈춰 있고 타이머가 걸리지 않는다', () => {
    const state = initial([P1, P2], 1_000)

    expect(state.phase).toBe('PREPARING')
    expect(state.nextActionAt).toBe(0)
    expect(state.ball).toMatchObject({
      direction: 1,
      faultFrom: 0,
      launchedAt: 1_000,
      pos: 0,
      smash: false,
      speed: NORMAL_SPEED,
      x0: 0.5,
      x1: 0.5,
    })
    expect(state.lastEvent).toMatchObject({ playerId: P1, type: 'READY' })
    expect(state.serveReceiverId).toBe(P1)
  })

  it('연습 스윙 전에는 준비를 받아들이지 않는다', () => {
    const fresh = initial([P1, P2], 1_000)

    expect(ready(fresh, P1, 1_100)).toBe(fresh)

    const practised = swing(fresh, P1, 0, 1_050, 0.5)
    expect(practised.lastEvent?.type).toBe('PRACTICE')
    expect(practised.nextActionAt).toBe(0)

    const declared = ready(practised, P1, 1_100)
    expect(declared.readyPlayerIds).toEqual([P1])
    expect(declared.lastEvent?.type).toBe('PLAYER_READY')
    expect(declared.phase).toBe('PREPARING')
  })

  it('같은 사람이 두 번 준비해도 한 번으로 센다', () => {
    let state = swing(initial([P1, P2], 1_000), P1, 0, 1_050, 0.5)
    state = ready(state, P1, 1_100)

    expect(ready(state, P1, 1_200)).toBe(state)
    expect(state.readyPlayerIds).toEqual([P1])
  })

  it('방에 없는 사람과 진행 중인 판의 준비는 흘려보낸다', () => {
    const fresh = initial([P1, P2], 1_000)
    expect(ready(fresh, '구경꾼', 1_100)).toBe(fresh)

    const playing = rallyState()
    expect(ready(playing, P1, 1_100)).toBe(playing)
  })

  it('카운트다운이 아닌 판에서는 서브가 나가지 않는다', () => {
    const playing = rallyState()

    expect(serve(playing, 5_000, 0.5)).toBe(playing)
  })

  it('서브한 공은 멈춤 없이 곧장 날아간다', () => {
    const counting: PingPongState = { ...rallyState(), phase: 'COUNTDOWN', serveReceiverId: P1 }

    const served = serve(counting, 5_000, 0.7)

    expect(served.ball).toMatchObject({
      direction: 1,
      faultFrom: 0,
      launchedAt: 5_000,
      pos: 0,
      smash: false,
      speed: NORMAL_SPEED,
      x0: 0.5,
      x1: 0.7,
    })
    expect(served.rally).toBe(0)
    expect(served.lastEvent).toMatchObject({ playerId: P1, type: 'SERVE' })
  })
})

describe('몰수', () => {
  it('나간 사람의 상대가 11점으로 이긴다', () => {
    const left = forfeit(rallyState(), P1, 5_000)

    expect(left.phase).toBe('FINISHED')
    expect(left.scores[P2]).toBe(11)
    expect(left.nextActionAt).toBe(0)
    expect(left.serveReceiverId).toBeUndefined()
    expect(left.lastEvent).toMatchObject({ playerId: P2, type: 'OPPONENT_LEFT' })

    expect(forfeit(rallyState(), P2, 5_000).scores[P1]).toBe(11)
  })

  it('방에 없는 사람과 이미 끝난 판의 이탈은 아무것도 하지 않는다', () => {
    const state = rallyState()
    const finished: PingPongState = { ...state, phase: 'FINISHED' }

    expect(forfeit(state, '구경꾼', 5_000)).toBe(state)
    expect(forfeit(finished, P1, 5_000)).toBe(finished)
  })
})

describe('판 번호', () => {
  it('상태가 바뀔 때마다 한 칸씩 올라간다', () => {
    const state = rallyState()

    expect(swing(state, P1, 0, 1_000, 0.5).version).toBe(state.version + 1)
    expect(expire(state, 9_000).version).toBe(state.version + 1)
    expect(forfeit(state, P1, 9_000).version).toBe(state.version + 1)

    const counting: PingPongState = { ...state, phase: 'COUNTDOWN' }
    expect(serve(counting, 9_000, 0.5).version).toBe(state.version + 1)

    const practising = initial([P1, P2], 1_000)
    expect(swing(practising, P1, 0, 1_100, 0.5).version).toBe(practising.version + 1)
    expect(ready(swing(practising, P1, 0, 1_100, 0.5), P1, 1_200).version).toBe(
      practising.version + 2,
    )
  })

  it('전원이 준비하면 카운트다운 마감이 잡힌다', () => {
    let state = swing(initial([P1, P2], 1_000), P1, 0, 1_050, 0.5)
    state = ready(state, P1, 1_100)
    state = swing(state, P2, 0, 1_150, 0.5)

    const started = ready(state, P2, 1_200)

    expect(started.phase).toBe('COUNTDOWN')
    expect(started.nextActionAt).toBe(1_200 + POINT_COUNTDOWN_MILLIS)
  })
})

describe('서브 교대의 산술', () => {
  it('합계 20 미만은 두 점 묶음, 20부터는 한 점씩이다', () => {
    const order = [P1, P2]
    const turnOf = (total: number) => {
      const half = Math.floor(total / 2)
      return serveReceiver(order, { [P1]: half, [P2]: total - half })
    }

    // 0~19: 두 점마다 바뀐다.
    expect(turnOf(16)).toBe(P1)
    expect(turnOf(17)).toBe(P1)
    expect(turnOf(18)).toBe(P2)
    expect(turnOf(19)).toBe(P2)
    // 20부터: 한 점마다 바뀐다.
    expect(turnOf(20)).toBe(P1)
    expect(turnOf(21)).toBe(P2)
    expect(turnOf(22)).toBe(P1)
  })
})

describe('1번 자리의 판정', () => {
  const swingAsP2 = (pos: number) => swing(rallyState({ direction: -1, pos }), P2, 0, 1_000, 0.5)

  it('이상점은 0번의 거울상이고 등급도 같은 거리로 갈린다', () => {
    expect(swingAsP2(W.ideal2).lastEvent?.type).toBe('SMASH')
    expect(swingAsP2(W.ideal2 + W.perfectDistance).lastEvent?.type).toBe('SMASH')
    expect(swingAsP2(W.ideal2 + W.goodDistance).lastEvent?.type).toBe('NICE')
    expect(swingAsP2(W.ideal2 + 0.101).lastEvent?.type).toBe('OK')
  })

  it('이른 쪽과 늦은 쪽이 0번과 반대로 뒤집힌다', () => {
    // 1번에게 오는 공은 pos가 줄어들며 다가온다 — 큰 pos가 이른 것이다.
    expect(swingAsP2(W.ideal2 + 0.141).lastEvent?.type).toBe('OUT')
    expect(swingAsP2(W.ideal2 - 0.121).lastEvent?.type).toBe('NET')
  })

  it('되받은 공은 0번 쪽으로 날아간다', () => {
    const returned = swingAsP2(W.ideal2)

    expect(returned.ball.direction).toBe(1)
    expect(returned.ball.speed).toBe(W.smashSpeed)
    expect(returned.rally).toBe(1)
  })
})

describe('폴트 공이 죽는 자리', () => {
  it('0번을 향해 넘어간 OUT 공은 테이블 오른쪽 밖에서 죽는다', () => {
    // P2가 쳐서 direction=+1로 나가는 OUT 공.
    const out = swing(rallyState({ direction: -1, pos: W.ideal2 + 0.141 }), P2, 0, 1_000, 0.5)
    expect(out.ball.fault).toBe('OUT')
    expect(out.ball.direction).toBe(1)

    // 1.5까지 가는 시간이어야 한다 — -0.5로 잡으면 이미 지난 자리라 즉시 죽는다.
    const distance = Math.abs(1.5 - out.ball.pos)
    expect(out.nextActionAt).toBe(1_000 + Math.round((distance / out.ball.speed) * 1_000))
    expect(out.nextActionAt).toBeGreaterThan(1_000 + 1_000)
  })

  it('1번을 향해 넘어간 OUT 공은 반대쪽 밖에서 죽는다', () => {
    const out = swing(rallyState({ pos: W.window1Low }), P1, 0, 1_000, 0.5)
    expect(out.ball.fault).toBe('OUT')
    expect(out.ball.direction).toBe(-1)

    const distance = Math.abs(-0.5 - out.ball.pos)
    expect(out.nextActionAt).toBe(1_000 + Math.round((distance / out.ball.speed) * 1_000))
  })

  it('폴트가 없으면 공에 그 표시 자체가 붙지 않는다', () => {
    const clean = swing(rallyState({ pos: W.ideal1 }), P1, 0, 1_000, 0.5)

    // `fault: undefined`가 실리면 와이어에 빈 키가 나가고 클라가 폴트 연출을 켠다.
    expect('fault' in clean.ball).toBe(false)
  })

  it('되받은 공은 판 번호를 올리고 랠리를 잇는다', () => {
    const state = rallyState({ pos: W.ideal1 })

    const returned = swing(state, P1, 0, 1_000, 0.5)

    expect(returned.version).toBe(state.version + 1)
    expect(returned.lastEvent?.id).toBe(state.version + 1)
  })
})

describe('연습과 준비의 조건', () => {
  it('연습 스윙은 준비 국면에서만 남는다', () => {
    const preparing = initial([P1, P2], 1_000)
    const playing = rallyState()

    expect(swing(preparing, P1, 0, 1_100, 0.5).lastEvent?.type).toBe('PRACTICE')
    // 진행 중에는 같은 자리가 판정으로 간다 — 연습으로 적히면 안 된다.
    expect(swing(playing, P1, 0, 1_100, 0.5).lastEvent?.type).not.toBe('PRACTICE')
  })

  it('준비는 국면·명단·연습 여부·중복을 각각 본다', () => {
    const practised = swing(initial([P1, P2], 1_000), P1, 0, 1_050, 0.5)

    // 국면만 어긋난 경우.
    const counting: PingPongState = { ...practised, phase: 'COUNTDOWN' }
    expect(ready(counting, P1, 1_100)).toBe(counting)
    // 명단만 어긋난 경우.
    expect(ready(practised, '구경꾼', 1_100)).toBe(practised)
    // 연습만 안 한 경우.
    expect(ready(practised, P2, 1_100)).toBe(practised)
    // 넷 다 맞으면 통과한다.
    expect(ready(practised, P1, 1_100)).not.toBe(practised)
  })

  it('받을 사람이 정해지지 않은 카운트다운은 0번에게 서브한다', () => {
    const counting: PingPongState = {
      ...rallyState(),
      phase: 'COUNTDOWN',
      serveReceiverId: undefined,
    }

    const served = serve(counting, 5_000, 0.5)

    // 명단에서 찾지 못하면 -1이므로 0번이 받는 쪽이 아니다 — 공이 1에서 출발한다.
    expect(served.ball.pos).toBe(1)
    expect(served.ball.direction).toBe(-1)
  })
})

describe('경계와 갈래를 한 자리씩', () => {
  it('진행 중이 아닌 판의 스윙은 판정으로 새지 않는다', () => {
    const counting: PingPongState = { ...rallyState({ pos: W.ideal1 }), phase: 'COUNTDOWN' }
    const finished: PingPongState = { ...rallyState({ pos: W.ideal1 }), phase: 'FINISHED' }

    const whileCounting = swing(counting, P1, 1, 1_000, 0.5)
    const whileFinished = swing(finished, P1, 1, 1_000, 0.5)

    // 이상점에서 친 스윙이지만 판이 열려 있지 않으므로 아무 이벤트도 생기지 않는다.
    expect(whileCounting.lastEvent).toBeUndefined()
    expect(whileCounting.ball).toBe(counting.ball)
    expect(whileFinished.lastEvent).toBeUndefined()
    expect(whileFinished.ball).toBe(finished.ball)
  })

  it('0번도 자기에게 오지 않는 공은 칠 수 없다', () => {
    // direction=-1이면 1번에게 가는 공이다.
    const away = rallyState({ direction: -1, pos: W.ideal1 })

    const swung = swing(away, P1, 1, 1_000, 0.5)

    expect(swung.lastEvent).toBeUndefined()
    expect(swung.ball.direction).toBe(-1)
    expect(swung.lastInputSeq[P1]).toBe(1)
  })

  it('0번을 향하는 정상 공은 0번 라켓 뒤에서 죽는다', () => {
    const returned = swing(rallyState({ direction: -1, pos: W.ideal2 }), P2, 0, 1_000, 0.5)
    expect(returned.ball.direction).toBe(1)
    expect(returned.ball.fault).toBeUndefined()

    // 반대쪽 끝(-0.1)이 아니라 0번 라켓 뒤(1.1)까지 가야 한다.
    const distance = Math.abs(W.miss1 - returned.ball.pos)
    expect(returned.nextActionAt).toBe(1_000 + Math.round((distance / returned.ball.speed) * 1_000))
  })

  it('폴트 여유의 경계는 값이 같을 때까지 폴트가 아니다', () => {
    // 이른 쪽 여유가 끝나는 정확한 자리.
    const atLimit = W.window1Low + W.faultBand
    expect(swing(rallyState({ pos: atLimit }), P1, 0, 1_000, 0.5).ball.fault).toBeUndefined()
    expect(swing(rallyState({ pos: atLimit - 0.0001 }), P1, 0, 1_000, 0.5).ball.fault).toBe('OUT')

    // 늦은 쪽도 마찬가지다.
    const atLateLimit = W.window1High - W.faultBand
    expect(swing(rallyState({ pos: atLateLimit }), P1, 0, 1_000, 0.5).ball.fault).toBeUndefined()
    expect(swing(rallyState({ pos: atLateLimit + 0.0001 }), P1, 0, 1_000, 0.5).ball.fault).toBe(
      'NET',
    )
  })

  it('1번 창의 위쪽 끝은 헛스윙이 아니다', () => {
    const atEdge = swing(rallyState({ direction: -1, pos: W.window2High }), P2, 0, 1_000, 0.5)
    const beyond = swing(
      rallyState({ direction: -1, pos: W.window2High + 0.0001 }),
      P2,
      0,
      1_000,
      0.5,
    )

    expect(atEdge.lastEvent?.type).not.toBe('TOO_EARLY')
    expect(beyond.lastEvent?.type).toBe('TOO_EARLY')
  })
})

describe('폴트 여유의 경계', () => {
  it('여유와 정확히 같은 거리는 아직 폴트가 아니다', () => {
    // `swing`으로는 부동소수점 때문에 경계에 정확히 설 수 없어 판정 함수를 직접 부른다.
    expect(faultOf(W.earlyLimit, true)).toBeUndefined()
    expect(faultOf(W.earlyLimit + Number.EPSILON, true)).toBe('OUT')

    expect(faultOf(W.lateLimit, false)).toBeUndefined()
    expect(faultOf(W.lateLimit + Number.EPSILON, false)).toBe('NET')
  })

  it('이른 쪽과 늦은 쪽의 여유가 다르다 — 창이 이상점을 가운데 두지 않는다', () => {
    expect(W.earlyLimit).toBeCloseTo(0.14, 10)
    expect(W.lateLimit).toBeCloseTo(0.12, 10)
    expect(faultOf(0.13, true)).toBeUndefined()
    expect(faultOf(0.13, false)).toBe('NET')
  })
})
