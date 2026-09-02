import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyScoreBoard, serverMessage, waitingRoomSnapshot } from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { useLocalRoomSnapshot } from '@/yacht/model/useLocalRoomSnapshot'

const P1 = waitingRoomSnapshot.players[0]?.playerId ?? 'player-1'

/** 판이 열린 방. 서버 없이 도는 연습·레버리지가 이 모양을 들고 시작한다. */
const playing = (): RoomSnapshot => ({
  ...waitingRoomSnapshot,
  phase: 'playing',
  game: {
    activePlayerId: P1,
    rollCount: 2,
    roundDeadline: 1_000,
    roundNumber: 1,
    scores: {},
    turnOrder: [P1],
  },
})

function renderSnapshot(initial: RoomSnapshot) {
  const client = new FakeRealtimeClient()
  const view = renderHook(() => useLocalRoomSnapshot(client, initial))
  return { ...view, client }
}

describe('useLocalRoomSnapshot', () => {
  it('판이 없는 방에는 게임 메시지가 닿지 않는다', () => {
    const view = renderSnapshot(waitingRoomSnapshot)

    act(() =>
      view.client.emitMessage(
        serverMessage('game.yacht_dice.game.over', { rankings: [] }, { roomId: 'ROOM1' }),
      ),
    )

    expect(view.result.current).toBe(waitingRoomSnapshot)
  })

  it('점수 갱신·라운드 시작·종료를 그 자리에서 반영한다', () => {
    const view = renderSnapshot(playing())

    act(() =>
      view.client.emitMessage(
        serverMessage('game.yacht_dice.score.update', {
          playerId: P1,
          scoreboard: { ...createEmptyScoreBoard(), total: 42 },
        }),
      ),
    )
    expect(view.result.current.game?.scores[P1]?.total).toBe(42)

    act(() =>
      view.client.emitMessage(
        serverMessage('game.yacht_dice.round.start', {
          activePlayerId: P1,
          deadline: 9_000,
          roundNumber: 2,
          turnOrder: [P1],
        }),
      ),
    )
    expect(view.result.current.game).toMatchObject({
      roundDeadline: 9_000,
      roundNumber: 2,
      // 새 라운드는 굴림 수를 되돌린다.
      rollCount: 0,
    })

    act(() =>
      view.client.emitMessage(
        serverMessage('game.yacht_dice.game.over', {
          rankings: [{ playerId: P1, rank: 1, total: 42 }],
        }),
      ),
    )
    expect(view.result.current.phase).toBe('finished')
    expect(view.result.current.game?.rankings).toHaveLength(1)
  })

  it('판과 무관한 메시지는 스냅샷을 흔들지 않는다', () => {
    const view = renderSnapshot(playing())
    const before = view.result.current

    act(() => view.client.emitMessage(serverMessage('sys.pong', { serverTs: 1 })))

    expect(view.result.current).toBe(before)
  })
})
