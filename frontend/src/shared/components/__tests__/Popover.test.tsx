import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Popover } from '../Popover'

const VIEWPORT = { height: 768, width: 1024 }

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

interface AnchorRect {
  bottom: number
  left: number
  top: number
  width: number
}

function anchorAt(rect: AnchorRect) {
  const element = document.createElement('button')
  moveAnchor(element, rect)
  document.body.append(element)
  return { current: element }
}

function moveAnchor(element: HTMLElement, rect: AnchorRect) {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.bottom,
      height: rect.bottom - rect.top,
      left: rect.left,
      right: rect.left + rect.width,
      top: rect.top,
      width: rect.width,
    }) as DOMRect
}

function renderAt(anchorRef: { current: HTMLElement }) {
  render(
    <Popover anchorRef={anchorRef} label="오디오 설정" onClose={vi.fn()} open={true}>
      <button type="button">닫기</button>
    </Popover>,
  )
  return screen.getByRole('dialog', { name: '오디오 설정' })
}

afterEach(() => setViewport(VIEWPORT.width, VIEWPORT.height))

describe('Popover 앵커 배치', () => {
  it('좁은 화면에서는 패널을 뷰포트 안으로 눌러 넣고 꼬리만 앵커를 따라간다', () => {
    setViewport(320, 568)
    const panel = renderAt(anchorAt({ bottom: 56, left: 260, top: 12, width: 44 }))

    expect(panel.style.left).toBe('12px')
    expect(panel.style.width).toBe('296px')
    expect(panel.style.top).toBe('66px')

    const tail = panel.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(Number.parseFloat(tail.style.left)).toBeCloseTo(282 - 12 - 7)
  })

  it('아래에 자리가 없고 위가 넓으면 위로 뒤집는다', () => {
    setViewport(1024, 768)
    const panel = renderAt(anchorAt({ bottom: 740, left: 480, top: 700, width: 44 }))

    expect(panel.style.top).toBe('')
    expect(panel.style.bottom).toBe('78px')
    const tail = panel.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(tail.className).toContain('-bottom-')
  })

  it('앵커가 스크롤로 움직이면 따라간다', () => {
    setViewport(1024, 768)
    const anchorRef = anchorAt({ bottom: 200, left: 480, top: 156, width: 44 })
    const panel = renderAt(anchorRef)
    expect(panel.style.top).toBe('210px')

    moveAnchor(anchorRef.current, { bottom: 160, left: 480, top: 116, width: 44 })
    act(() => {
      document.body.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(panel.style.top).toBe('170px')
  })
})
