import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creatorPlayer, serverMessage } from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { ClientMessage } from '@/realtime/wsEvents'
import { FLIGHT_MS, MAX_FLYING } from '@/yacht/domain/reactions'
import { useReactionDock } from '@/yacht/model/useReactionDock'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function renderDock() {
  const client = new FakeRealtimeClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
  )
  const view = renderHook(() => useReactionDock([creatorPlayer]), { wrapper })
  const react = (reaction: string, playerId = creatorPlayer.playerId) =>
    act(() =>
      client.emitMessage(serverMessage('reaction.broadcast', { playerId, reaction } as never)),
    )
  return { ...view, client, react, sent: () => client.sentMessages as ClientMessage[] }
}

describe('useReactionDock 날아오는 반응', () => {
  it('보낸 사람의 이름을 붙여 띄우고 시간이 지나면 걷는다', () => {
    const dock = renderDock()

    dock.react('clap')

    expect(dock.result.current.flying[0]).toMatchObject({ nickname: creatorPlayer.nickname })

    act(() => void vi.advanceTimersByTime(FLIGHT_MS + 10))
    expect(dock.result.current.flying).toHaveLength(0)
  })

  it('모르는 반응과 모르는 사람도 자리를 잃지 않는다', () => {
    const dock = renderDock()

    dock.react('알수없음', '유령')

    expect(dock.result.current.flying[0]).toMatchObject({ emoji: '💬', label: '', nickname: '' })
  })

  it('한꺼번에 몰려도 정해진 개수만 남긴다', () => {
    const dock = renderDock()

    for (let index = 0; index < MAX_FLYING + 3; index += 1) dock.react('clap')

    expect(dock.result.current.flying).toHaveLength(MAX_FLYING)
  })
})

describe('useReactionDock 고르기', () => {
  it('Escape와 바깥 누름이 창을 닫는다', () => {
    const dock = renderDock()

    act(() => dock.result.current.setOpen(true))
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(dock.result.current.open).toBe(false)

    act(() => dock.result.current.setOpen(true))
    act(() => void document.dispatchEvent(new PointerEvent('pointerdown')))
    expect(dock.result.current.open).toBe(false)
  })

  it('좌우 키로 칩 사이를 옮겨 다니고 다른 키는 흘려보낸다', () => {
    const dock = renderDock()
    const press = (key: string) => {
      const event = { key, preventDefault: vi.fn() }
      act(() => dock.result.current.handleChipKeyDown(event as never))
      return event
    }

    const moved = press('ArrowRight')
    expect(moved.preventDefault).toHaveBeenCalled()
    expect(dock.result.current.focusedChip).toBe(1)

    const ignored = press('KeyQ')
    expect(ignored.preventDefault).not.toHaveBeenCalled()
    expect(dock.result.current.focusedChip).toBe(1)
  })

  it('반응을 보내고, 연결이 끊겨 있어도 화면이 멎지 않는다', () => {
    const dock = renderDock()

    act(() => dock.result.current.send('clap'))
    expect(dock.sent()[0]).toMatchObject({ type: 'reaction.send', payload: { reaction: 'clap' } })

    vi.spyOn(dock.client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })
    expect(() => act(() => dock.result.current.send('clap'))).not.toThrow()
  })
})
