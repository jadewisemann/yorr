import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { RecordPanel } from './RecordPanel'

beforeAll(() => {
  // jsdom에는 포인터 캡처가 없다. 드래그 계약을 검증하려면 자리만 채워 준다.
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
})

function renderPanel(open: boolean, onToggle = vi.fn()) {
  const view = render(
    <RecordPanel
      onToggle={onToggle}
      open={open}
      quick={<button type="button">퀵 기록 요트</button>}
      subtitle="합계 128"
      title="내 점수"
    >
      <p>점수시트 본문</p>
      <button type="button">시트 안 버튼</button>
    </RecordPanel>,
  )
  return { ...view, onToggle, user: userEvent.setup() }
}

/** 드래그 손잡이 = 토글 버튼을 품고 있는 touch-none 영역. */
function handleOf() {
  const toggle = screen.getByRole('button', { name: /내 점수/ })
  const handle = toggle.parentElement
  if (!handle) throw new Error('손잡이 영역을 찾지 못했다')
  return handle
}

function drag(element: Element, from: number, to: number) {
  fireEvent.pointerDown(element, { clientY: from, pointerId: 1 })
  fireEvent.pointerMove(element, { clientY: to, pointerId: 1 })
  fireEvent.pointerUp(element, { pointerId: 1 })
}

describe('RecordPanel', () => {
  it('접힌 상태에서도 퀵 칩과 전체 시트가 함께 남는다', () => {
    renderPanel(false)

    expect(screen.getByRole('button', { name: '퀵 기록 요트' })).toBeVisible()
    expect(screen.getByRole('button', { name: '시트 안 버튼' })).toBeInTheDocument()
  })

  it('토글 버튼이 시트 영역과 펼침 상태를 알린다', () => {
    const { onToggle, rerender } = renderPanel(false)

    const toggle = screen.getByRole('button', { name: /내 점수/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('전체 시트')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).not.toBeNull()

    rerender(
      <RecordPanel onToggle={onToggle} open quick={<span />} subtitle="합계 128" title="내 점수">
        <span />
      </RecordPanel>,
    )
    const openedToggle = screen.getByRole('button', { name: /내 점수/ })
    expect(openedToggle).toHaveAttribute('aria-expanded', 'true')
    expect(openedToggle).toHaveTextContent('접기')
  })

  it('토글 버튼은 현재 상태를 뒤집는다', async () => {
    const { onToggle, user } = renderPanel(false)

    await user.click(screen.getByRole('button', { name: /내 점수/ }))
    expect(onToggle).toHaveBeenLastCalledWith(true)
  })

  // 드래그를 모르는 사람도 막히지 않게, 접힌 패널은 아무 데나 눌러도 열린다.
  it('접힌 패널 아무 곳을 눌러도 열린다', async () => {
    const { onToggle, user } = renderPanel(false)

    await user.click(screen.getByText('점수시트 본문'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  // 퀵 칩은 자기 동작이 우선이다 — 칩을 눌렀다고 시트가 열려 버리면 기록이 가려진다.
  it('접힌 상태에서 퀵 칩을 눌러도 시트를 열지 않는다', async () => {
    const { onToggle, user } = renderPanel(false)

    await user.click(screen.getByRole('button', { name: '퀵 기록 요트' }))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('열린 상태에서 손잡이를 누르면 닫힌다', async () => {
    const { onToggle, user } = renderPanel(true)

    await user.click(handleOf())
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  // 시트 본문 탭은 기록 조작이다 — 여기서 닫히면 점수를 고를 수 없다.
  it('열린 상태에서 시트 본문 탭은 닫기로 새지 않는다', async () => {
    const { onToggle, user } = renderPanel(true)

    await user.click(screen.getByRole('button', { name: '시트 안 버튼' }))
    await user.click(screen.getByText('점수시트 본문'))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('열린 상태에서는 시트 밖을 눌러 닫을 수 있다', async () => {
    const { onToggle, user } = renderPanel(true)

    await user.click(screen.getByRole('button', { name: '점수시트 닫기' }))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('접힌 상태에는 바깥 스크림이 없어 뒤 화면 조작을 막지 않는다', () => {
    renderPanel(false)

    expect(screen.queryByRole('button', { name: '점수시트 닫기' })).not.toBeInTheDocument()
  })

  it('열린 시트를 충분히 아래로 끌면 닫는다', () => {
    const { onToggle } = renderPanel(true)

    drag(handleOf(), 100, 200)
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('살짝만 끌면 상태를 바꾸지 않고 제자리로 돌아온다', () => {
    const { onToggle } = renderPanel(true)

    drag(handleOf(), 100, 120)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('접힌 시트를 충분히 위로 끌면 열린다', () => {
    const { onToggle } = renderPanel(false)

    drag(handleOf(), 200, 100)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('누르지 않은 채 지나간 포인터 이동은 무시한다', () => {
    const { onToggle } = renderPanel(true)
    const handle = handleOf()

    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('드래그가 취소되면 상태를 바꾸지 않는다', () => {
    const { onToggle } = renderPanel(true)
    const handle = handleOf()

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 110, pointerId: 1 })
    fireEvent.pointerCancel(handle, { pointerId: 1 })
    expect(onToggle).not.toHaveBeenCalled()
  })
})
