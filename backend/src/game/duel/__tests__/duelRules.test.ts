import { describe, expect, it } from 'vitest'
import {
  compareDraw,
  draw,
  expire,
  FOUL,
  FREEZE_MILLIS,
  finish,
  forfeit,
  GRACE_MILLIS,
  hold,
  initialDuelState,
  KO_HOLD_MILLIS,
  MAX_FOULS,
  MAX_HP,
  MISS,
  nextRound,
  RESULT_HOLD_MILLIS,
  signal,
  TIE_HOLD_MILLIS,
} from '../duelRules.js'
import type { DuelRound, DuelState } from '../duelState.js'

/**
 * 결투 규칙 12종 — **이 12개가 결투 규칙의 명세다.**
 */
const P1 = 'player-1'
const P2 = 'player-2'

const initial = (): DuelState => initialDuelState([P1, P2], 1_000, 2_000)

/** `lastRound`가 없는 프레임은 규칙 위반이다 — 테스트에서 옵셔널을 좁혀 쓴다. */
const lastRound = (state: DuelState): DuelRound => {
  const round = state.lastRound
  if (round === undefined) throw new Error('lastRound가 비어 있다')
  return round
}

/**
 * P1이 라운드를 이긴 결과 프레임. P2는 얼어붙은 것으로 기록된다(만료).
 * `hits`만큼 반복하면 P2의 체력이 그만큼 깎인다.
 */
const wonRounds = (hits: number): DuelState => {
  let state = initial()
  for (let hit = 0; hit < hits; hit += 1) {
    const now = 5_000 + hit * 1_000
    state = draw(signal(state, now), P1, hit + 1, 200, now + 200)
    state = expire(state, now + 400)
    if (!state.lastRound?.over && hit < hits - 1) state = nextRound(state, now + 600, 2_000)
  }
  return state
}

describe('DuelRules', () => {
  it('더 빨리 뽑은 쪽이 상대를 쏜다', () => {
    const signalled = signal(initial(), 5_000)

    const first = draw(signalled, P1, 1, 180, 5_200)
    const resolved = draw(first, P2, 1, 240, 5_260)

    expect(resolved.phase).toBe('RESULT')
    expect(lastRound(resolved).kind).toBe('SHOT')
    expect(lastRound(resolved).shooterId).toBe(P1)
    expect(resolved.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP - 1 })
    expect(lastRound(resolved).over).toBe(false)
  })

  it('같은 밀리초는 무승부이고 아무도 총알을 잃지 않는다', () => {
    const signalled = signal(initial(), 5_000)

    const first = draw(signalled, P1, 1, 200, 5_220)
    const resolved = draw(first, P2, 1, 200, 5_230)

    expect(lastRound(resolved).kind).toBe('TIE')
    expect(lastRound(resolved).hitId).toBeNull()
    expect(resolved.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP })
  })

  /** 첫 부정출발은 상대를 무피해로 두고 경고만 남긴다 — 손떨림 한 번에 체력을 깎지 않는다. */
  it('첫 부정출발은 경고만 남긴다', () => {
    const fouled = draw(initial(), P1, 1, 120, 2_000)

    expect(lastRound(fouled).kind).toBe('WARNING')
    expect(lastRound(fouled).foulId).toBe(P1)
    expect(fouled.fouls[P1]).toBe(1)
    expect(fouled.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP })
  })

  /** 두 번째 부정출발은 총알이 남아 있어도 그 자리에서 결투를 끝낸다. */
  it('두 번째 부정출발은 즉시 결투를 잃는다', () => {
    const warned = nextRound(draw(initial(), P1, 1, -1, 2_000), 3_000, 1_500)

    const selfShot = draw(warned, P1, 2, -1, 3_400)

    expect(lastRound(selfShot).kind).toBe('SELF_SHOT')
    expect(lastRound(selfShot).hitId).toBe(P1)
    expect(lastRound(selfShot).koId).toBe(P1)
    expect(lastRound(selfShot).over).toBe(true)
    expect(selfShot.hp).toEqual({ [P1]: MAX_HP - 1, [P2]: MAX_HP })
    // 경고는 리셋되지 않는다 — 이 값이 곧 실격 사유다.
    expect(selfShot.fouls[P1]).toBe(MAX_FOULS)
    expect(hold(lastRound(selfShot))).toBe(KO_HOLD_MILLIS)
    expect(finish(selfShot).phase).toBe('FINISHED')
  })

  /** 경고는 라운드를 넘어 누적된다 — 라운드마다 두 번씩 기회를 주는 게 아니다. */
  it('경고는 라운드 간 누적된다', () => {
    const signalled = signal(initial(), 5_000)
    const fouled = draw(signalled, P1, 1, -1, 5_100)

    expect(lastRound(fouled).kind).toBe('WARNING')
    expect(fouled.fouls[P1]).toBe(1)

    const next = nextRound(fouled, 9_000, 1_500)

    expect(next.round).toBe(2)
    expect(next.fouls[P1]).toBe(1)
  })

  /** 신호 전 입력은 payload가 어떤 ms를 신고해도 부정출발이다 — 판정 권한은 서버에 있다. */
  it('신호 전 draw는 항상 부정출발이다', () => {
    const fouled = draw(initial(), P2, 1, 999, 2_000)

    expect(fouled.reactions[P2]).toBe(FOUL)
  })

  /** 서버에 흐른 시간보다 빠른 기록은 낼 수 없다 — 왕복 지연만큼은 클라이언트 편을 들어준다. */
  it('신고한 반응 시간은 서버 경과시간으로 깎인다', () => {
    const signalled = signal(initial(), 5_000)

    const drawn = draw(signalled, P1, 1, 900, 5_400)

    expect(drawn.reactions[P1]).toBe(400)
  })

  it('아무도 뽑지 않으면 라운드가 무효가 된다', () => {
    const signalled = signal(initial(), 5_000)

    const expired = expire(signalled, signalled.nextActionAt)

    expect(lastRound(expired).kind).toBe('TIE')
    expect(expired.reactions).toEqual({ [P1]: MISS, [P2]: MISS })
    expect(expired.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP })
  })

  /** 한쪽만 뽑고 유예가 끝나면 얼어붙은 쪽이 그대로 맞는다. */
  it('얼어붙은 쪽이 총알을 맞는다', () => {
    const signalled = signal(initial(), 5_000)
    const drawn = draw(signalled, P1, 1, 200, 5_200)

    const resolved = expire(drawn, drawn.nextActionAt)

    expect(lastRound(resolved).shooterId).toBe(P1)
    expect(resolved.hp[P2]).toBe(MAX_HP - 1)
  })

  it('세 번째 피격으로 결투가 끝나고 그다음 종료된다', () => {
    let state = initial()
    for (let round = 0; round < MAX_HP; round += 1) {
      const signalAt = 5_000 + round * 10_000
      state = signal(state, signalAt)
      state = draw(state, P1, round + 1, 180, signalAt + 200)
      state = draw(state, P2, round + 1, 300, signalAt + 320)
      if (!lastRound(state).over) state = nextRound(state, signalAt + 4_000, 1_500)
    }

    expect(state.hp[P2]).toBe(0)
    expect(lastRound(state).koId).toBe(P2)
    expect(lastRound(state).over).toBe(true)
    expect(state.phase).toBe('RESULT')
    expect(hold(lastRound(state))).toBe(KO_HOLD_MILLIS)

    const finished = finish(state)

    expect(finished.phase).toBe('FINISHED')
  })

  it('같은 입력 시퀀스는 무시된다', () => {
    const signalled = signal(initial(), 5_000)
    const drawn = draw(signalled, P1, 1, 200, 5_200)

    const repeated = draw(drawn, P1, 1, 100, 5_300)

    expect(repeated).toEqual(drawn)
  })

  it('이탈한 플레이어는 결투를 몰수당한다', () => {
    const finished = forfeit(initial(), P1, 2_000)

    expect(finished.phase).toBe('FINISHED')
    expect(finished.hp).toEqual({ [P1]: 0, [P2]: MAX_HP })
    expect(lastRound(finished).kind).toBe('FORFEIT')
    expect(lastRound(finished).shooterId).toBe(P2)
  })

  /**
   * 위 12종이 고정하지 못하는 비교 표(둘 다 실패·한쪽만 유효)를 직접 짚는다 —
   * `expire`·`draw` 경로가 전부 이 함수를 지나므로 회귀가 가장 먼저 여기서 드러난다.
   */
  it('compareDraw: 둘 다 실패면 무승부, 한쪽만 유효하면 그쪽이 이긴다', () => {
    expect(compareDraw(180, 240)).toBe(1)
    expect(compareDraw(240, 180)).toBe(2)
    expect(compareDraw(200, 200)).toBe(0)
    expect(compareDraw(200, MISS)).toBe(1)
    expect(compareDraw(FOUL, 200)).toBe(2)
    expect(compareDraw(MISS, MISS)).toBe(0)
    expect(compareDraw(FOUL, FOUL)).toBe(0)
  })

  /**
   * 아래 다섯은 **잘못 불린 전이가 상태를 건드리지 않는다**는 계약이다. 서비스가 예약을
   * 잘못 걸거나 늦게 도착한 마감이 지나간 국면을 때릴 때 여기서 막힌다.
   */
  /**
   * 상태는 Redis에서 JSON으로 되돌아오므로 명단이 깨진 채 도착할 수 있다. 그때는 조용히
   * 이상한 판정을 내지 말고 던져야 한다 — 저장소가 그 예외로 갱신을 버린다.
   */
  it('명단이 깨진 상태로는 판정하지 않고 던진다', () => {
    const broken: DuelState = { ...initial(), playerOrder: [P1] }

    expect(() => forfeit(broken, P1, 2_000)).toThrow('duel_requires_two_players')
  })

  it('두 사람이 아닌 명단으로는 판을 열 수 없다', () => {
    expect(() => initialDuelState([P1], 1_000, 2_000)).toThrow('duel_requires_two_players')
    expect(() => initialDuelState([P1, P2, 'player-3'], 1_000, 2_000)).toThrow(
      'duel_requires_two_players',
    )
  })

  it('방에 없는 사람의 뽑기는 무시한다', () => {
    const signalled = signal(initial(), 5_000)

    expect(draw(signalled, '구경꾼', 1, 200, 5_200)).toEqual(signalled)
  })

  it('이미 뽑은 사람의 두 번째 뽑기는 입력 번호만 남기고 기록을 덮지 않는다', () => {
    const drawn = draw(signal(initial(), 5_000), P1, 1, 200, 5_200)

    const again = draw(drawn, P1, 7, 150, 5_400)

    // 번호는 올려 둔다 — 그래야 같은 입력이 다음 라운드에서 되살아나지 않는다.
    expect(again.lastInputSeq[P1]).toBe(7)
    expect(again.reactions).toEqual(drawn.reactions)
    expect(again.version).toBe(drawn.version + 1)
  })

  it('신호 국면이 아닐 때의 만료는 아무것도 하지 않는다', () => {
    const waiting = initial()

    expect(expire(waiting, 9_000)).toEqual(waiting)
  })

  it('결과 국면이 아니거나 이미 끝난 판에서는 라운드를 넘기지도 끝내지도 않는다', () => {
    const waiting = initial()
    expect(nextRound(waiting, 9_000, 2_000)).toEqual(waiting)
    expect(finish(waiting)).toEqual(waiting)

    // KO가 난 라운드는 다음 라운드로 넘어가지 않고, 아직 안 끝난 라운드는 종료되지 않는다.
    const ko = wonRounds(MAX_HP)
    expect(ko.lastRound?.over).toBe(true)
    expect(nextRound(ko, 9_000, 2_000)).toEqual(ko)

    const midRound = wonRounds(1)
    expect(midRound.phase).toBe('RESULT')
    expect(midRound.lastRound?.over).toBe(false)
    expect(finish(midRound)).toEqual(midRound)
  })
  /**
   * 아래는 **시각과 값이 계약인 자리**들이다. 결투는 서버가 예약한 마감 하나로만
   * 굴러가므로(`nextActionAt`), 그 값이 한 번 어긋나면 라운드가 통째로 멎거나
   * 두 번 판정된다. 상태 전이가 맞아도 여기가 틀리면 게임이 되지 않는다.
   */
  describe('시각과 값', () => {
    it('신호를 켜면 얼어붙기 마감이 그 자리에서 잡힌다', () => {
      const signalled = signal(initial(), 5_000)

      expect(signalled.signalAt).toBe(5_000)
      expect(signalled.nextActionAt).toBe(5_000 + FREEZE_MILLIS)
      expect(signalled.version).toBe(initial().version + 1)
      expect(signalled.lastRound).toBeUndefined()
    })

    it('한쪽이 뽑으면 상대의 마감이 짧은 유예로 당겨진다', () => {
      const signalled = signal(initial(), 5_000)

      const drawn = draw(signalled, P1, 1, 200, 5_200)

      expect(drawn.nextActionAt).toBe(5_200 + GRACE_MILLIS)
      expect(drawn.version).toBe(signalled.version + 1)
      // 원래 마감이 더 가까우면 그것을 지킨다 — 유예가 마감을 늘리면 안 된다.
      const late = draw(signalled, P1, 1, 200, 5_000 + FREEZE_MILLIS - 100)
      expect(late.nextActionAt).toBe(signalled.nextActionAt)
    })

    it('판정이 끝나면 연출 길이만큼 다음 마감이 밀린다', () => {
      const signalled = signal(initial(), 5_000)
      const shot = draw(draw(signalled, P1, 1, 180, 5_200), P2, 1, 240, 5_260)

      expect(shot.nextActionAt).toBe(5_260 + RESULT_HOLD_MILLIS)

      const tie = draw(draw(signalled, P1, 1, 200, 5_220), P2, 1, 200, 5_230)
      expect(tie.nextActionAt).toBe(5_230 + TIE_HOLD_MILLIS)
    })

    it('연출 길이는 라운드의 성격마다 다르다', () => {
      const ko = { hitId: P2, over: true } as DuelRound
      const shot = { hitId: P2, over: false } as DuelRound
      const tie = { hitId: null, over: false } as DuelRound

      expect(hold(ko)).toBe(KO_HOLD_MILLIS)
      expect(hold(shot)).toBe(RESULT_HOLD_MILLIS)
      expect(hold(tie)).toBe(TIE_HOLD_MILLIS)
      expect(RESULT_HOLD_MILLIS).toBeGreaterThan(TIE_HOLD_MILLIS)
    })

    it('다음 라운드의 신호는 받은 대기 시간만큼 뒤에 켜진다', () => {
      const midRound = wonRounds(1)

      const next = nextRound(midRound, 9_000, 2_000)

      expect(next.nextActionAt).toBe(11_000)
      expect(next.signalAt).toBe(0)
      expect(next.round).toBe(midRound.round + 1)
      expect(next.version).toBe(midRound.version + 1)
    })

    it('결투가 끝나면 더 기다릴 것이 없다', () => {
      const ko = wonRounds(MAX_HP)

      const finished = finish(ko)

      expect(finished.nextActionAt).toBe(0)
      expect(finished.version).toBe(ko.version + 1)
      expect(forfeit(initial(), P1, 2_000).nextActionAt).toBe(0)
    })
  })

  describe('반응 시간 판정', () => {
    it('음수를 신고하면 부정출발이고, 0은 그대로 유효한 반응이다', () => {
      const signalled = signal(initial(), 5_000)

      // 클라이언트가 음수를 보냈다면 신호 전에 뽑았다는 뜻이다.
      expect(draw(signalled, P1, 1, -5, 5_200).reactions[P1]).toBe(FOUL)
      // 0ms는 경계이자 유효한 값이다 — 사람이 낼 수는 없어도 규칙이 접으면 안 된다.
      expect(draw(signalled, P1, 1, 0, 5_200).reactions[P1]).toBe(0)
    })

    it('첫 뽑기는 입력 번호가 없어도 받아들인다', () => {
      const signalled = signal(initial(), 5_000)
      const fresh: DuelState = { ...signalled, lastInputSeq: {} }

      const drawn = draw(fresh, P1, 0, 200, 5_200)

      expect(drawn.reactions[P1]).toBe(200)
      expect(drawn.lastInputSeq[P1]).toBe(0)
    })

    it('결과 국면에 들어온 뽑기는 번호만 남기고 판정을 건드리지 않는다', () => {
      const midRound = wonRounds(1)

      const late = draw(midRound, P2, 9, 100, 9_000)

      expect(late.reactions).toEqual(midRound.reactions)
      expect(late.lastInputSeq[P2]).toBe(9)
      expect(late.version).toBe(midRound.version + 1)
    })

    it('compareDraw는 센티넬 경계에서 갈린다', () => {
      // 0ms는 유효한 반응이다 — 부호로 가르므로 경계가 여기다.
      expect(compareDraw(0, 1)).toBe(1)
      expect(compareDraw(1, 0)).toBe(2)
      expect(compareDraw(0, 0)).toBe(0)
      expect(compareDraw(0, FOUL)).toBe(1)
      expect(compareDraw(FOUL, 0)).toBe(2)
    })
  })

  describe('부정출발과 몰수', () => {
    it('두 번째 사람의 부정출발도 그 사람의 것으로 잡는다', () => {
      const signalled = signal(initial(), 5_000)

      // P1은 정상, P2가 신호 전 값을 신고했다.
      const first = draw(signalled, P1, 1, 200, 5_200)
      const resolved = draw(first, P2, 1, -1, 5_210)

      expect(lastRound(resolved).foulId).toBe(P2)
      expect(lastRound(resolved).kind).toBe('WARNING')
      // 부정출발한 쪽만 값을 치른다 — 상대는 무피해다.
      expect(resolved.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP })
    })

    it('명단의 두 번째 사람이 나가면 첫 번째가 살아남는다', () => {
      const finished = forfeit(initial(), P2, 2_000)

      expect(finished.hp).toEqual({ [P1]: MAX_HP, [P2]: 0 })
      expect(lastRound(finished).shooterId).toBe(P1)
      expect(lastRound(finished).over).toBe(true)
      expect(finished.version).toBe(initial().version + 1)
    })

    it('명단의 두 번째 자리가 비어도 판정하지 않고 던진다', () => {
      const broken: DuelState = { ...initial(), playerOrder: [P1, undefined as unknown as string] }

      expect(() => forfeit(broken, P1, 2_000)).toThrow('duel_requires_two_players')
    })

    it('이미 끝난 판과 방에 없는 사람의 이탈은 아무것도 하지 않는다', () => {
      const ko = finish(wonRounds(MAX_HP))

      expect(forfeit(ko, P1, 9_000)).toEqual(ko)
      expect(forfeit(initial(), '구경꾼', 9_000)).toEqual(initial())
    })
  })

  describe('총알과 KO', () => {
    it('마지막 총알을 맞은 쪽만 KO로 적히고 판이 끝난다', () => {
      const twoHits = wonRounds(MAX_HP - 1)
      expect(lastRound(twoHits).koId).toBeNull()
      expect(lastRound(twoHits).over).toBe(false)

      const ko = wonRounds(MAX_HP)
      expect(lastRound(ko).koId).toBe(P2)
      expect(lastRound(ko).over).toBe(true)
      expect(ko.hp[P2]).toBe(0)
    })

    it('무승부 라운드는 아무도 쏘지 않고 판도 끝나지 않는다', () => {
      const signalled = signal(initial(), 5_000)

      const tie = draw(draw(signalled, P1, 1, 200, 5_220), P2, 1, 200, 5_230)

      expect(lastRound(tie).shooterId).toBeNull()
      expect(lastRound(tie).hitId).toBeNull()
      expect(lastRound(tie).koId).toBeNull()
      expect(lastRound(tie).over).toBe(false)
      expect(lastRound(tie).number).toBe(signalled.round)
    })

    it('두 번째 사람이 이기면 첫 번째가 맞는다', () => {
      const signalled = signal(initial(), 5_000)

      const resolved = draw(draw(signalled, P1, 1, 240, 5_260), P2, 1, 180, 5_280)

      expect(lastRound(resolved).shooterId).toBe(P2)
      expect(lastRound(resolved).hitId).toBe(P1)
      expect(resolved.hp).toEqual({ [P1]: MAX_HP - 1, [P2]: MAX_HP })
    })
  })
  /**
   * 아래는 **상태가 어긋난 채 도착했을 때** 규칙이 무엇을 하는지다. 상태는 Redis에서
   * JSON으로 되돌아오고 서비스가 예약을 잘못 걸 수도 있으므로, 국면과 마지막 라운드가
   * 서로 맞지 않는 프레임이 실제로 들어온다.
   */
  describe('어긋난 상태', () => {
    it('결과가 남아 있어도 국면이 결과가 아니면 라운드를 넘기지 않는다', () => {
      const midRound = wonRounds(1)
      const mismatched: DuelState = { ...midRound, phase: 'WAITING' }

      expect(nextRound(mismatched, 9_000, 2_000)).toEqual(mismatched)
      expect(finish({ ...wonRounds(MAX_HP), phase: 'WAITING' })).toEqual({
        ...wonRounds(MAX_HP),
        phase: 'WAITING',
      })
    })

    it('국면이 결과인데 마지막 라운드가 비어 있으면 그대로 둔다', () => {
      const empty: DuelState = { ...initial(), phase: 'RESULT', lastRound: undefined }

      expect(nextRound(empty, 9_000, 2_000)).toEqual(empty)
      expect(finish(empty)).toEqual(empty)
    })

    it('판정이 끝난 뒤 아직 뽑지 않았던 사람의 뽑기도 번호만 남긴다', () => {
      // 한쪽의 부정출발로 즉시 판정된 라운드. 상대의 반응은 비어 있다.
      const fouled = draw(signal(initial(), 5_000), P1, 1, -1, 5_200)
      expect(fouled.phase).toBe('RESULT')
      expect(fouled.reactions[P2]).toBeUndefined()

      const late = draw(fouled, P2, 1, 200, 5_300)

      expect(late.reactions).toEqual(fouled.reactions)
      expect(late.lastRound).toEqual(fouled.lastRound)
      expect(late.lastInputSeq[P2]).toBe(1)
    })

    it('명단이 한 사람뿐이면 판정 자체를 하지 않는다', () => {
      const broken: DuelState = { ...initial(), playerOrder: [P1] }

      expect(() => forfeit(broken, P1, 2_000)).toThrow('duel_requires_two_players')
      // 만료 판정도 같은 자리에서 막힌다 — 조용히 이상한 결과를 내지 않는다.
      const signalled: DuelState = { ...signal(initial(), 5_000), playerOrder: [P1] }
      expect(() => expire(signalled, 9_000)).toThrow('duel_requires_two_players')
    })

    it('명단의 어느 자리가 비었든 똑같이 막는다', () => {
      // JSON으로 되돌아온 상태는 앞자리가 빌 수도 있다 — 두 자리를 각각 봐야 한다.
      const noFirst: DuelState = {
        ...initial(),
        playerOrder: [undefined as unknown as string, P2],
      }
      const noSecond: DuelState = {
        ...initial(),
        playerOrder: [P1, undefined as unknown as string],
      }

      expect(() => forfeit(noFirst, P2, 2_000)).toThrow('duel_requires_two_players')
      expect(() => forfeit(noSecond, P1, 2_000)).toThrow('duel_requires_two_players')
    })
  })
})
