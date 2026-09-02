import { describe, expect, it } from 'vitest'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { toRanking } from '@/yacht/domain/resultRanking'

const ME = 'me'
const RIVAL = 'rival'

const snapshotOf = (game: RoomSnapshot['game']): RoomSnapshot =>
  ({
    roomId: 'room-1',
    phase: 'finished',
    players: [
      { playerId: ME, nickname: '나', status: 'online' },
      { playerId: RIVAL, nickname: '상대', status: 'online' },
    ],
    game,
  }) as unknown as RoomSnapshot

/**
 * 결과 화면의 줄 순서. **서버 순위가 있으면 그것이 정본**이고, 없을 때만 점수판으로
 * 세운다 — 두 경로가 다른 순서를 내면 사람마다 다른 결과를 보게 된다.
 */
describe('toRanking', () => {
  it('서버 순위가 오면 그 순서를 그대로 쓰고 닉네임만 붙인다', () => {
    const ranked = toRanking(
      snapshotOf({
        rankings: [
          { rank: 1, playerId: RIVAL, total: 205 },
          { rank: 2, playerId: ME, total: 180 },
        ],
      } as RoomSnapshot['game']),
      ME,
    )

    expect(ranked.map((player) => player.playerId)).toEqual([RIVAL, ME])
    expect(ranked[0]?.nickname).toBe('상대')
  })

  it('명단에 없는 사람의 순위도 버리지 않는다', () => {
    const ranked = toRanking(
      snapshotOf({
        rankings: [{ rank: 1, playerId: '떠난사람', total: 100 }],
      } as RoomSnapshot['game']),
      ME,
    )

    expect(ranked[0]?.nickname).toBe('알 수 없는 참가자')
  })

  it('서버 순위가 없으면 점수 내림차순으로 세우고 동점이면 내가 위다', () => {
    const ranked = toRanking(
      snapshotOf({
        scores: { [ME]: { total: 180 }, [RIVAL]: { total: 205 } },
      } as unknown as RoomSnapshot['game']),
      ME,
    )
    expect(ranked.map((player) => player.playerId)).toEqual([RIVAL, ME])

    const tied = toRanking(
      snapshotOf({
        scores: { [ME]: { total: 180 }, [RIVAL]: { total: 180 } },
      } as unknown as RoomSnapshot['game']),
      ME,
    )
    expect(tied.map((player) => player.playerId)).toEqual([ME, RIVAL])

    // 내가 뒤에 있어도 동점이면 앞으로 온다 — 비교의 두 방향이 대칭이어야 한다.
    const tiedFromRival = toRanking(
      snapshotOf({
        scores: { [ME]: { total: 180 }, [RIVAL]: { total: 180 } },
      } as unknown as RoomSnapshot['game']),
      RIVAL,
    )
    expect(tiedFromRival.map((player) => player.playerId)).toEqual([RIVAL, ME])
  })

  it('나와 무관한 두 사람이 동점이면 명단 순서를 그대로 둔다', () => {
    const withThird = {
      ...snapshotOf({
        scores: { [ME]: { total: 100 }, [RIVAL]: { total: 180 } },
      } as unknown as RoomSnapshot['game']),
    }
    const players = [
      ...withThird.players,
      { playerId: 'third', nickname: '셋째', status: 'online' },
    ]
    const ranked = toRanking(
      {
        ...withThird,
        players,
        game: {
          scores: { [ME]: { total: 100 }, [RIVAL]: { total: 180 }, third: { total: 180 } },
        },
      } as unknown as RoomSnapshot,
      ME,
    )

    // 상대와 셋째가 동점이고 둘 다 내가 아니다 — 뒤집지 않는다.
    expect(ranked.map((player) => player.playerId)).toEqual([RIVAL, 'third', ME])
  })

  it('점수판도 없으면 모두 0점으로 세운다', () => {
    const ranked = toRanking(snapshotOf(undefined), ME)

    expect(ranked.every((player) => player.total === 0)).toBe(true)
  })
})
