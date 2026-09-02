import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dimsAroundHole, spotlightFor, useSpotlight } from '@/yacht/model/useSpotlight'

/** 화면에 자리를 잡은 요소 하나. jsdom은 크기를 재지 않으므로 값을 직접 심는다. */
function placeTarget(attribute: string, box: { top: number; left: number }) {
  const element = document.createElement('button')
  element.setAttribute(attribute, '')
  element.getBoundingClientRect = () =>
    ({ bottom: box.top + 20, left: box.left, right: box.left + 40, top: box.top }) as DOMRect
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSpotlight', () => {
  it('가리킬 것이 없으면 구멍을 뚫지 않는다', () => {
    const { result } = renderHook(() => useSpotlight(null))

    expect(result.current).toBeNull()
  })

  it('찾지 못한 선택자에도 구멍은 비어 있다', () => {
    const { result } = renderHook(() => useSpotlight('[data-없음]'))

    expect(result.current).toBeNull()
  })

  it('여러 요소를 한 구멍으로 묶고, 보이도록 굴려 준 뒤 크기 변화를 지켜본다', () => {
    const first = placeTarget('data-tutorial-target', { left: 10, top: 10 })
    const second = placeTarget('data-tutorial-target', { left: 100, top: 40 })
    first.scrollIntoView = vi.fn()
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = disconnect
        unobserve = vi.fn()
      },
    )

    const { result, unmount } = renderHook(() => useSpotlight('[data-tutorial-target]'))

    expect(result.current).toEqual({ height: 50, left: 10, top: 10, width: 130 })
    expect(first.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' })
    expect(observe).toHaveBeenCalledWith(first)

    unmount()
    expect(disconnect).toHaveBeenCalled()
    expect(second.isConnected).toBe(true)
  })

  it('시트 안의 요소는 그 시트 안에서만 찾는다', () => {
    const sheet = document.createElement('div')
    sheet.setAttribute('data-tutorial', 'sheet')
    document.body.append(sheet)
    const inside = placeTarget('data-tutorial-target', { left: 0, top: 0 })
    sheet.append(inside)
    // 시트 밖에도 같은 표시가 있지만 구멍에 들어오지 않는다.
    placeTarget('data-tutorial-target', { left: 500, top: 500 })

    const { result } = renderHook(() => useSpotlight('[data-tutorial-target]'))

    expect(result.current).toEqual({ height: 20, left: 0, top: 0, width: 40 })
  })
})

describe('spotlightFor', () => {
  it('족보를 가리킬 때는 그 칸을, 상단 묶음일 때는 여섯 칸을 함께 가리킨다', () => {
    expect(spotlightFor('roll', { category: 'fourOfAKind' } as never)).toBe(
      '[data-tutorial-category="fourOfAKind"]',
    )
    const upper = spotlightFor('roll', {} as never)
    expect(upper).toContain('[data-tutorial-category="ones"]')
    expect(upper?.split(',')).toHaveLength(6)
  })

  it('단계마다 가리키는 자리가 다르고, 가리킬 것이 없는 단계도 있다', () => {
    expect(spotlightFor('roll', undefined)).toBe('[data-tutorial="roll"]')
    expect(spotlightFor('keep', undefined)).toBe('[data-tutorial="tray"]')
    expect(spotlightFor('motion', undefined)).toBe('[data-tutorial="motion"]')
    expect(spotlightFor('record', undefined)).toBe('[data-tutorial-category="fourOfAKind"]')
    expect(spotlightFor('categories', undefined)).toBeNull()
  })
})

describe('dimsAroundHole', () => {
  it('기록하는 단계에서는 주변을 어둡게 하지 않는다', () => {
    expect(dimsAroundHole('roll')).toBe(true)
    expect(dimsAroundHole('record')).toBe(false)
    expect(dimsAroundHole('categories')).toBe(false)
  })
})
