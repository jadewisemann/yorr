import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Popover } from '../Popover'

/**
 * 앵커 배치의 두 가지 함정만 잡는다 — 화면 밖으로 나가는 것과, 아래에 자리가 없는데도
 * 아래로 펴지는 것. 나머지(스크림·Escape)는 앵커 유무와 무관한 기존 동작이다.
 */

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

/** 원하는 위치에 있는 척하는 앵커. jsdom은 레이아웃을 계산하지 않는다. */
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
    // 헤더 우측 끝 버튼 — 중앙에 맞추면 패널 오른쪽이 화면 밖으로 나간다.
    const panel = renderAt(anchorAt({ bottom: 56, left: 260, top: 12, width: 44 }))

    expect(panel.style.left).toBe('12px')
    expect(panel.style.width).toBe('296px')
    expect(panel.style.top).toBe('66px')

    // 꼬리는 눌린 패널 안에 남으면서 앵커 중앙(282px)을 가리킨다.
    const tail = panel.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(Number.parseFloat(tail.style.left)).toBeCloseTo(282 - 12 - 7)
  })

  it('아래에 자리가 없고 위가 넓으면 위로 뒤집는다', () => {
    setViewport(1024, 768)
    const panel = renderAt(anchorAt({ bottom: 740, left: 480, top: 700, width: 44 }))

    // 아래가 아니라 위로 자란다 — top 대신 bottom을 잡고 꼬리도 아래를 향한다.
    expect(panel.style.top).toBe('')
    expect(panel.style.bottom).toBe('78px')
    const tail = panel.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(tail.className).toContain('-bottom-')
  })

  /**
   * 예전엔 resize만 들어서, 앵커가 스크롤로 움직여도 팝오버가 제자리에 남았다.
   * scroll은 버블하지 않으므로 캡처 단계로 받는다 — 어느 조상이 스크롤되든 잡힌다.
   */
  it('앵커가 스크롤로 움직이면 따라간다', () => {
    setViewport(1024, 768)
    const anchorRef = anchorAt({ bottom: 200, left: 480, top: 156, width: 44 })
    const panel = renderAt(anchorRef)
    expect(panel.style.top).toBe('210px')

    // 스크롤 컨테이너가 40px 올라가 앵커도 그만큼 위로 갔다.
    moveAnchor(anchorRef.current, { bottom: 160, left: 480, top: 116, width: 44 })
    act(() => {
      document.body.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(panel.style.top).toBe('170px')
  })
})
