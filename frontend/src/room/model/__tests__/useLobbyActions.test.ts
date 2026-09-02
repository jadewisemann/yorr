import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitingRoomSnapshot } from '@/mocks/fixtures'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { useLobbyActions } from '@/room/model/useLobbyActions'

/** 세 요청 대역. 검사가 진행 상태와 오류를 직접 세워 화면으로 어떻게 올라오는지 본다. */
const { addBot, removeBot, startGame } = vi.hoisted(() => {
  const task = () => ({ error: null as string | null, execute: vi.fn(), isLoading: false })
  return { addBot: task(), removeBot: task(), startGame: task() }
})

vi.mock('@/room/api/useGameApi', () => ({
  useAddBot: () => addBot,
  useRemoveBot: () => removeBot,
  useStartGame: () => startGame,
}))

afterEach(() => {
  vi.clearAllMocks()
  for (const task of [addBot, removeBot, startGame]) {
    task.error = null
    task.isLoading = false
  }
})

const render = (options: {
  canStart?: boolean
  capacity?: number
  isHost?: boolean
  snapshot?: RoomSnapshot | null
}) =>
  renderHook(() =>
    useLobbyActions({
      canStart: options.canStart ?? true,
      capacity: options.capacity ?? 4,
      isHost: options.isHost ?? true,
      snapshot: options.snapshot === undefined ? waitingRoomSnapshot : options.snapshot,
    }),
  )

describe('useLobbyActions', () => {
  it('방장만 봇을 넣을 수 있고, 자리가 다 차면 넣지 않는다', async () => {
    const guest = render({ isHost: false })
    await act(() => guest.result.current.addBot())
    expect(addBot.execute).not.toHaveBeenCalled()

    const noRoom = render({ capacity: waitingRoomSnapshot.players.length })
    await act(() => noRoom.result.current.addBot())
    expect(addBot.execute).not.toHaveBeenCalled()

    const empty = render({ snapshot: null })
    await act(() => empty.result.current.addBot())
    expect(addBot.execute).not.toHaveBeenCalled()

    const host = render({})
    await act(() => host.result.current.addBot())
    expect(addBot.execute).toHaveBeenCalledOnce()
  })

  it('시작할 수 없는 방에서는 시작이 나가지 않는다', async () => {
    const waiting = render({ canStart: false })
    await act(() => waiting.result.current.start())
    expect(startGame.execute).not.toHaveBeenCalled()

    const ready = render({})
    await act(() => ready.result.current.start())
    expect(startGame.execute).toHaveBeenCalledOnce()
  })

  it('봇 빼기는 그 자리 번호를 그대로 넘긴다', () => {
    const view = render({})

    act(() => view.result.current.removeBot('bot-1'))

    expect(removeBot.execute).toHaveBeenCalledWith('bot-1')
  })

  it('두 봇 요청의 오류와 진행 상태를 한 자리로 모아 보여 준다', () => {
    addBot.isLoading = true
    removeBot.error = '삭제 실패'

    const view = render({})

    expect(view.result.current.addingBot).toBe(true)
    expect(view.result.current.botLoading).toBe(true)
    expect(view.result.current.botError).toBe('삭제 실패')
  })

  it('시작 요청의 오류와 진행 상태를 그대로 올린다', () => {
    startGame.error = '시작 실패'
    startGame.isLoading = true

    const view = render({})

    expect(view.result.current.startError).toBe('시작 실패')
    expect(view.result.current.startLoading).toBe(true)
  })
})
