import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDavinciGame } from '@/davinci/model/useDavinciGame'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { ClientMessage, DavinciView } from '@/realtime/wsEvents'

const ME = 'player-1'
const RIVAL = 'player-2'
const ROOM = 'room-1'

const view = (overrides: Partial<DavinciView> = {}): DavinciView => ({
  deckCount: 10,
  eliminated: [],
  hands: {
    [ME]: [{ color: 'BLACK', id: 'me-1', number: 3, revealed: false }],
    [RIVAL]: [{ color: 'WHITE', id: 'rival-1', number: null, revealed: false }],
  },
  hits: { [ME]: 0, [RIVAL]: 0 },
  lastInputSeq: { [ME]: 0, [RIVAL]: 0 },
  nextActionAt: 0,
  phase: 'GUESSING',
  playerOrder: [ME, RIVAL],
  turn: 1,
  turnPlayerId: ME,
  version: 1,
  ...overrides,
})

function renderGame(initial?: DavinciView) {
  const client = new FakeRealtimeClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
  )
  const rendered = renderHook(
    ({ state }: { state: DavinciView | undefined }) =>
      useDavinciGame({ roomId: ROOM, state, you: ME }),
    { initialProps: { state: initial }, wrapper },
  )
  return { ...rendered, client, sent: () => client.sentMessages as ClientMessage[] }
}

describe('useDavinciGame 추측', () => {
  it('타일과 숫자가 모두 골라진 뒤에야 추측을 보낸다', () => {
    const game = renderGame(view())

    act(() => game.result.current.guess())
    expect(game.sent()).toHaveLength(0)

    act(() => game.result.current.selectTile(RIVAL, 'rival-1'))
    act(() => game.result.current.guess())
    expect(game.sent()).toHaveLength(0)

    act(() => game.result.current.selectNumber(5))
    act(() => game.result.current.guess())

    expect(game.sent()[0]).toMatchObject({
      type: 'game.davinci_code.guess',
      payload: { inputSeq: 1, number: 5, targetId: RIVAL, tileId: 'rival-1' },
      roomId: ROOM,
    })
  })

  it('같은 타일을 다시 누르면 선택이 풀린다', () => {
    const game = renderGame(view())

    act(() => game.result.current.selectTile(RIVAL, 'rival-1'))
    expect(game.result.current.selection).toEqual({ playerId: RIVAL, tileId: 'rival-1' })

    act(() => game.result.current.selectTile(RIVAL, 'rival-1'))
    expect(game.result.current.selection).toBeNull()
  })

  it('내 차례가 아니면 타일을 고를 수 없다', () => {
    const game = renderGame(view({ turnPlayerId: RIVAL }))

    act(() => game.result.current.selectTile(RIVAL, 'rival-1'))

    expect(game.result.current.selection).toBeNull()
  })

  it('턴이 넘어가면 아직 보내지 않은 선택을 버린다', () => {
    const game = renderGame(view())

    act(() => game.result.current.selectTile(RIVAL, 'rival-1'))
    act(() => game.result.current.selectNumber(5))

    game.rerender({ state: view({ turn: 2 }) })

    expect(game.result.current.selection).toBeNull()
    expect(game.result.current.number).toBeNull()
  })
})

describe('useDavinciGame 결정과 놓기', () => {
  it('계속·멈춤과 놓을 자리는 입력 번호를 올려 가며 보낸다', () => {
    const game = renderGame(view())

    act(() => game.result.current.decide('CONTINUE'))
    act(() => game.result.current.place(2))

    expect(game.sent()[0]).toMatchObject({
      type: 'game.davinci_code.decide',
      payload: { decision: 'CONTINUE', inputSeq: 1 },
    })
    expect(game.sent()[1]).toMatchObject({
      type: 'game.davinci_code.place',
      payload: { index: 2, inputSeq: 2 },
    })
  })

  it('전송이 실패하면 다시 하라고 알리고, 다음 전송이 되면 지운다', () => {
    const game = renderGame(view())
    const send = vi.spyOn(game.client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })

    act(() => game.result.current.decide('STOP'))
    expect(game.result.current.sendError).toBe('연결을 확인한 뒤 다시 시도해 주세요.')

    send.mockRestore()
    act(() => game.result.current.decide('STOP'))
    expect(game.result.current.sendError).toBeNull()
  })

  it('아직 판이 오지 않았어도 훅은 서 있는다', () => {
    const game = renderGame()

    act(() => game.result.current.selectTile(RIVAL, 'rival-1'))

    expect(game.result.current.selection).toBeNull()
    expect(game.sent()).toHaveLength(0)
  })
})
