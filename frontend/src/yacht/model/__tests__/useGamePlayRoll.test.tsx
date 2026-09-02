import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyScoreBoard, creatorSession } from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { ClientMessage, GameState } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { useGamePlayRoll } from '@/yacht/model/useGamePlayRoll'

const ME = creatorSession.you
const ROOM = creatorSession.roomId

const gameState = (overrides: Partial<GameState> = {}): GameState => ({
  activePlayerId: ME,
  rollCount: 0,
  roundDeadline: null,
  roundNumber: 1,
  scores: { [ME]: createEmptyScoreBoard() },
  turnOrder: [ME],
  ...overrides,
})

function renderRoll(options: { canPlay?: boolean; game?: GameState } = {}) {
  useAppStore.getState().reset()
  useAppStore.getState().setConnectionStatus('connected')
  const client = new FakeRealtimeClient()
  const showToast = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
  )
  const view = renderHook(
    () =>
      useGamePlayRoll({
        canPlay: options.canPlay ?? true,
        game: options.game ?? gameState(),
        roomId: ROOM,
        showToast,
        you: ME,
      }),
    { wrapper },
  )
  return { ...view, client, sent: () => client.sentMessages as ClientMessage[], showToast }
}

describe('useGamePlayRoll 굴릴 수 없을 때', () => {
  it('내 차례가 아니면 굴리기가 나가지 않는다', () => {
    const view = renderRoll({ game: gameState({ activePlayerId: 'player-2' }) })

    act(() => view.result.current.roll())

    expect(view.sent()).toHaveLength(0)
  })

  it('굴릴 수 없으면 킵도 바꿀 수 없다', () => {
    const view = renderRoll({ canPlay: false })

    act(() => view.result.current.toggleHeld(0))

    expect(view.result.current.local.held).toEqual([false, false, false, false, false])
  })

  it('굴리는 중이 아니면 던지기 확정은 아무것도 하지 않는다', () => {
    const view = renderRoll()

    act(() => view.result.current.confirmThrow())

    expect(view.sent()).toHaveLength(0)
  })

  it('내가 부르지 않은 굴림의 완료는 흘려보낸다', () => {
    const view = renderRoll()

    act(() => view.result.current.completeRoll('남의-굴림', [1, 1, 1, 1, 1]))

    expect(view.result.current.local.rollCount).toBe(0)
  })
})

describe('useGamePlayRoll 굴리기', () => {
  it('굴리면 이번 굴림 번호와 킵 상태를 실어 요청한다', () => {
    const view = renderRoll()

    act(() => view.result.current.roll())

    expect(view.sent()[0]).toMatchObject({
      type: 'game.yacht_dice.dice.roll',
      payload: { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
      roomId: ROOM,
    })
    expect(view.result.current.rolling).toBe(true)
  })

  it('전송이 실패하면 다시 하라고 알리고 굴림 상태를 되돌린다', () => {
    const view = renderRoll()
    vi.spyOn(view.client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })

    act(() => view.result.current.roll())

    expect(view.showToast).toHaveBeenCalledWith(
      '주사위를 요청하지 못했어요. 연결 상태를 확인해 주세요.',
    )
    expect(view.result.current.rolling).toBe(false)
  })
})
