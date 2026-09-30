import { expect } from 'vitest'
import type { Prng } from '../fuzz/prng.js'
import { oracleScore, oracleSheet, YACHT_CATEGORIES, type YachtCategory } from '../oracles/yacht.js'
import { authHeaders, request, startGame } from './http.js'
import type { Seat } from './players.js'
import type { Target } from './target.js'
import type { Envelope } from './ws.js'

/** 야추 네임스페이스 메시지 타입. */
export const yacht = (event: string): string => `game.yacht_dice.${event}`

export interface RoundStart {
  readonly roundNumber: number
  readonly deadline: number | null
  readonly activePlayerId: string
  readonly turnOrder: readonly string[]
}

interface DiceBroadcast {
  readonly playerId: string
  readonly roundNumber: number
  readonly rollCount: number
  readonly dice: readonly number[]
  readonly held: readonly boolean[]
  readonly auto?: boolean
}

interface Ranking {
  readonly rank: number
  readonly playerId: string
  readonly total: number
}

export type Step =
  | { readonly kind: 'turn'; readonly turn: RoundStart }
  | { readonly kind: 'over'; readonly rankings: readonly Ranking[] }

/** 한 턴에서 무엇을 지키고 어디에 기록할지. 서버를 검증하는 쪽이 아니라 두드리는 쪽이다. */
export interface YachtStrategy {
  /** 굴린 뒤 다음 굴림에서 지킬 주사위. `null`이면 그만 굴리고 기록한다. */
  keep(dice: readonly number[], rollCount: number, open: readonly YachtCategory[]): boolean[] | null
  choose(dice: readonly number[], open: readonly YachtCategory[]): YachtCategory
}

const mostCommonFace = (dice: readonly number[]): number =>
  [6, 5, 4, 3, 2, 1].reduce((best, face) =>
    dice.filter((die) => die === face).length > dice.filter((die) => die === best).length
      ? face
      : best,
  )

const bestOpen = (dice: readonly number[], open: readonly YachtCategory[]): YachtCategory =>
  open.reduce((best, category) =>
    oracleScore(category, dice) > oracleScore(best, dice) ? category : best,
  )

/** 가장 많은 눈을 지키고 나머지를 다시 굴린다. 30점 이상이 보이면 멈춘다. */
export const greedyStrategy: YachtStrategy = {
  keep: (dice, rollCount, open) => {
    if (rollCount >= 3 || oracleScore(bestOpen(dice, open), dice) >= 30) return null
    const face = mostCommonFace(dice)
    return dice.map((die) => die === face)
  },
  choose: bestOpen,
}

/** 퍼저용 — 킵·멈춤·칸 선택을 전부 시드에서 뽑는다. */
export const randomStrategy = (random: Prng): YachtStrategy => ({
  keep: (dice, rollCount) =>
    rollCount >= 3 || random.chance(0.35) ? null : dice.map(() => random.chance(0.5)),
  choose: (_dice, open) => random.pick(open),
})

/** 동점은 playerId의 코드 포인트 순서로 가른다(서버와 같은 규칙 — 로케일 비교가 아니다). */
const byIdCodePoint = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const expectedRankings = (totals: ReadonlyMap<string, number>): Ranking[] => {
  const ordered = [...totals].sort(
    ([leftId, left], [rightId, right]) => right - left || byIdCodePoint(leftId, rightId),
  )
  return ordered.map(([playerId, total]) => ({
    // 경쟁 순위(1, 1, 3): 같은 점수는 같은 순위, 다음 순위는 사람 수만큼 건너뛴다.
    rank: ordered.findIndex(([, other]) => other === total) + 1,
    playerId,
    total,
  }))
}

/**
 * 프로토콜만으로 야추 한 판을 끝까지 진행하며 **매 메시지를 검증한다.**
 *
 * - 팬아웃: 방송은 모든 자리가 같은 순서·같은 내용으로 받는다.
 * - 서버 권위: 주사위는 서버가 만들고, 지킨 자리는 이전 눈을 유지한다.
 * - 점수: 매 `score.update`의 점수판 전체(칸·소계·보너스·합계)가 독립 오라클과 같다.
 * - 종료: `game.over` 순위가 오라클 합계의 경쟁 순위와 같고, 조회 REST도 같은 답을 낸다.
 */
export class YachtGame {
  private readonly sheets = new Map<string, Partial<Record<YachtCategory, number>>>()
  private readonly seats: readonly Seat[]
  readonly roomId: string

  constructor(seats: readonly Seat[]) {
    const host = seats[0]
    if (host === undefined) throw new Error('자리가 하나도 없다')
    this.seats = seats
    this.roomId = host.entrant.roomId
  }

  /** 호스트가 REST로 시작하고, 모두가 첫 `round.start`를 받을 때까지. */
  async start(target: Target): Promise<Step> {
    await startGame(target, this.host.entrant)
    // 시작은 `state.sync`(phase playing) → 첫 `round.start` 순서로 온다.
    const synced = await this.everyone<{ snapshot: { phase: string } }>(yacht('state.sync'))
    expect(synced.snapshot.phase).toBe('playing')
    const turn = await this.everyone<RoundStart>(yacht('round.start'))
    expect(turn.roundNumber).toBe(1)
    expect([...turn.turnOrder].sort()).toEqual(this.seats.map((seat) => seat.entrant.id).sort())
    expect(turn.turnOrder[0]).toBe(this.host.entrant.id)
    expect(turn.activePlayerId).toBe(this.host.entrant.id)
    return { kind: 'turn', turn }
  }

  async playTurn(turn: RoundStart, strategy: YachtStrategy): Promise<Step> {
    const actor = this.seatOf(turn.activePlayerId)
    const open = this.openCategories(actor.entrant.id)
    const dice = await this.roll(actor, turn, strategy, open)
    const category = strategy.choose(dice, open)
    const msgId = actor.ws.send(
      yacht('round.submit'),
      { roundNumber: turn.roundNumber, dice, category },
      { roomId: this.roomId },
    )
    const update = await this.everyone<unknown>(yacht('score.update'), (m) => m.msgId === msgId)
    const sheet = { ...this.sheets.get(actor.entrant.id), [category]: oracleScore(category, dice) }
    this.sheets.set(actor.entrant.id, sheet)
    expect(update).toEqual({ playerId: actor.entrant.id, scoreboard: oracleSheet(sheet) })
    return this.afterSubmit(turn)
  }

  /** 끝날 때까지 두드린다. 한 판의 턴 수는 12 × 사람 수다. */
  async playToEnd(target: Target, strategy: YachtStrategy): Promise<readonly Ranking[]> {
    let step = await this.start(target)
    let turns = 0
    while (step.kind === 'turn') {
      step = await this.playTurn(step.turn, strategy)
      turns += 1
    }
    expect(turns).toBe(YACHT_CATEGORIES.length * this.seats.length)
    return step.rankings
  }

  /** `/rooms/{code}/results`가 방송된 순위와 같은 답을 내는지. */
  async expectResultsMatch(target: Target, rankings: readonly Ranking[]): Promise<void> {
    const result = await request(target, 'GET', `/api/v1/rooms/${this.roomId}/results`, {
      headers: authHeaders(this.host.entrant),
    })
    expect(result.status).toBe(200)
    expect(result.json<{ rankings: Ranking[] }>().rankings).toEqual(rankings)
  }

  private get host(): Seat {
    return this.seats[0] as Seat
  }

  private seatOf(playerId: string): Seat {
    const seat = this.seats.find((candidate) => candidate.entrant.id === playerId)
    if (seat === undefined) throw new Error(`이 방에 없는 턴 주인: ${playerId}`)
    return seat
  }

  private openCategories(playerId: string): YachtCategory[] {
    const sheet = this.sheets.get(playerId) ?? {}
    return YACHT_CATEGORIES.filter((category) => sheet[category] === undefined)
  }

  private async roll(
    actor: Seat,
    turn: RoundStart,
    strategy: YachtStrategy,
    open: readonly YachtCategory[],
  ): Promise<number[]> {
    let held = [false, false, false, false, false]
    let dice: readonly number[] = []
    for (let rollCount = 1; ; rollCount += 1) {
      const msgId = actor.ws.send(
        yacht('dice.roll'),
        { roundNumber: turn.roundNumber, rollCount, held },
        { roomId: this.roomId },
      )
      const rolled = await this.everyone<DiceBroadcast>(
        yacht('dice.broadcast'),
        (m) => m.msgId === msgId,
      )
      expect(rolled).toMatchObject({
        playerId: actor.entrant.id,
        roundNumber: turn.roundNumber,
        rollCount,
        held,
        auto: false,
      })
      expect(rolled.dice).toHaveLength(5)
      for (const [index, die] of rolled.dice.entries()) {
        expect(Number.isInteger(die) && die >= 1 && die <= 6).toBe(true)
        if (held[index]) expect(die).toBe(dice[index])
      }
      dice = rolled.dice
      // 굴릴 때마다 마감이 다시 걸리며 같은 턴의 round.start가 다시 온다(마감 연장 계약).
      const restarted = await this.everyone<RoundStart>(yacht('round.start'))
      expect(restarted).toMatchObject({
        roundNumber: turn.roundNumber,
        activePlayerId: actor.entrant.id,
      })
      const keep = strategy.keep(dice, rollCount, open)
      if (keep === null) return [...dice]
      held = keep
    }
  }

  private async afterSubmit(turn: RoundStart): Promise<Step> {
    for (;;) {
      const next = await this.everyoneOneOf([
        yacht('round.end'),
        yacht('round.start'),
        yacht('game.over'),
      ])
      if (next.type === yacht('round.end')) {
        expect(next.payload).toEqual({
          roundNumber: turn.roundNumber,
          submitted: [...turn.turnOrder],
        })
        continue
      }
      if (next.type === yacht('round.start'))
        return { kind: 'turn', turn: next.payload as RoundStart }
      const { rankings } = next.payload as { rankings: Ranking[] }
      const totals = new Map(
        this.seats.map((seat) => [
          seat.entrant.id,
          oracleSheet(this.sheets.get(seat.entrant.id) ?? {}).total,
        ]),
      )
      expect(rankings).toEqual(expectedRankings(totals))
      const synced = await this.everyone<{ snapshot: { phase: string } }>(yacht('state.sync'))
      expect(synced.snapshot.phase).toBe('finished')
      return { kind: 'over', rankings }
    }
  }

  /** 모든 자리가 같은 방송을 받았는지 확인하고 그 payload를 돌려준다. */
  private async everyone<T>(type: string, accept?: (message: Envelope) => boolean): Promise<T> {
    const copies = await Promise.all(this.seats.map((seat) => seat.ws.next(type, accept)))
    const [first, ...rest] = copies
    for (const other of rest) expect(other.payload).toEqual(first?.payload)
    return first?.payload as T
  }

  private async everyoneOneOf(types: readonly string[]): Promise<Envelope> {
    const copies = await Promise.all(this.seats.map((seat) => seat.ws.next(types)))
    const [first, ...rest] = copies
    if (first === undefined) throw new Error('자리가 하나도 없다')
    for (const other of rest) {
      expect({ type: other.type, payload: other.payload }).toEqual({
        type: first.type,
        payload: first.payload,
      })
    }
    return first
  }
}
