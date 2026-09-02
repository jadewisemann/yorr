import { act, renderHook } from '@testing-library/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { games } from '@/games'
import { useHeroCarousel } from '@/landing/model/useHeroCarousel'

const { reduceMotion } = vi.hoisted(() => ({ reduceMotion: { value: false } }))

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => reduceMotion.value,
}))

/** 끌기 판정만 보는 최소 포인터 이벤트. 캡처는 화면이 아니라 훅의 관심사다. */
const pointer = (
  overrides: Partial<ReactPointerEvent<HTMLDivElement>> = {},
): ReactPointerEvent<HTMLDivElement> =>
  ({
    button: 0,
    buttons: 1,
    clientX: 0,
    currentTarget: { setPointerCapture: vi.fn() },
    pointerId: 1,
    ...overrides,
  }) as unknown as ReactPointerEvent<HTMLDivElement>

function renderCarousel(activeIndex = 0) {
  const onSelect = vi.fn()
  const view = renderHook(
    ({ index }: { index: number }) =>
      useHeroCarousel({ activeIndex: index, games, layout: 'narrow', onSelect }),
    { initialProps: { index: activeIndex } },
  )
  return { ...view, onSelect }
}

describe('useHeroCarousel 끌기', () => {
  beforeEach(() => {
    reduceMotion.value = false
  })

  it('왼쪽 버튼이 아닌 눌림은 끌기를 시작하지 않는다', () => {
    const view = renderCarousel()

    act(() => view.result.current.handlePointerDown(pointer({ button: 2 })))
    act(() => view.result.current.handlePointerMove(pointer({ clientX: 100 })))

    expect(view.result.current.dragOffset).toBe(0)
  })

  it('문턱을 넘긴 만큼만 밀리고, 충분히 끌면 다음 칸으로 넘어간다', () => {
    const view = renderCarousel()

    act(() => view.result.current.handlePointerDown(pointer()))
    // 문턱(8px) 안쪽 움직임은 끌기로 치지 않는다.
    act(() => view.result.current.handlePointerMove(pointer({ clientX: 4 })))
    expect(view.result.current.dragOffset).toBe(0)

    act(() => view.result.current.handlePointerMove(pointer({ clientX: -60 })))
    expect(view.result.current.dragOffset).toBe(-60)

    act(() => view.result.current.handlePointerUp())
    expect(view.onSelect).toHaveBeenCalledWith(1)
  })

  it('버튼을 뗀 채 들어온 움직임은 그 자리에서 끌기를 끝낸다', () => {
    const view = renderCarousel()

    act(() => view.result.current.handlePointerDown(pointer()))
    act(() => view.result.current.handlePointerMove(pointer({ clientX: -60 })))
    // 창 밖에서 버튼을 뗐다면 up 이벤트가 오지 않는다 — 다음 move가 대신 끝낸다.
    act(() => view.result.current.handlePointerMove(pointer({ buttons: 0, clientX: -60 })))

    expect(view.onSelect).toHaveBeenCalledWith(1)
    expect(view.result.current.dragOffset).toBe(0)
  })

  it('끌지 않은 채 뗀 손가락은 아무 일도 만들지 않는다', () => {
    const view = renderCarousel()

    act(() => view.result.current.handlePointerUp())
    act(() => view.result.current.handlePointerDown(pointer()))
    act(() => view.result.current.handlePointerUp())

    expect(view.onSelect).not.toHaveBeenCalled()
  })

  it('조금만 끌고 놓으면 제자리로 돌아온다', () => {
    const view = renderCarousel()

    act(() => view.result.current.handlePointerDown(pointer()))
    act(() => view.result.current.handlePointerMove(pointer({ clientX: -20 })))
    act(() => view.result.current.handlePointerUp())

    expect(view.onSelect).not.toHaveBeenCalled()
    expect(view.result.current.dragOffset).toBe(0)
  })
})

describe('useHeroCarousel 미끄러짐', () => {
  it('움직임을 줄이라고 했으면 자리만 옮기고 미끄러지지 않는다', () => {
    reduceMotion.value = true
    const view = renderCarousel()

    view.rerender({ index: 1 })

    expect(view.result.current.trackX.get()).toBe(0)
    expect(view.result.current.reduceMotion).toBe(true)
  })

  it('양 끝에서도 이웃 카드가 끊기지 않고 이어진다', () => {
    const view = renderCarousel(0)

    // 첫 칸의 왼쪽 이웃은 마지막 칸이다.
    expect(view.result.current.previousIndex).toBe(games.length - 1)
    expect(view.result.current.previous).toBe(games.at(-1))

    view.rerender({ index: games.length - 1 })

    expect(view.result.current.nextIndex).toBe(0)
    expect(view.result.current.next).toBe(games[0])
  })
})
