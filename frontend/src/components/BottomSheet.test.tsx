import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { domAnimation, LazyMotion } from 'motion/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from './BottomSheet'

beforeAll(() => {
  // jsdom에는 포인터 캡처가 없다. 드래그 계약을 검증하려면 자리만 채워 준다.
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
})

/** 드래그 손잡이 = 시트 첫 자식(touch-none 영역). */
function handleOf() {
  const handle = screen.getByRole('dialog').firstElementChild
  if (!handle) throw new Error('손잡이 영역을 찾지 못했다')
  return handle
}

function renderSheet(onClose = vi.fn()) {
  render(
    <LazyMotion features={domAnimation}>
      <BottomSheet onClose={onClose} open title="족보 선택">
        <button type="button">첫 버튼</button>
        <button type="button">마지막 버튼</button>
      </BottomSheet>
    </LazyMotion>,
  )
  return { onClose, user: userEvent.setup() }
}

describe('BottomSheet', () => {
  it('renders nothing while closed', () => {
    render(
      <BottomSheet onClose={vi.fn()} open={false} title="족보 선택">
        <button type="button">첫 버튼</button>
      </BottomSheet>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is a modal dialog named after its title', () => {
    renderSheet()

    expect(screen.getByRole('dialog', { name: '족보 선택' })).toHaveAttribute('aria-modal', 'true')
  })

  it('moves focus into the sheet when it opens', () => {
    renderSheet()

    expect(screen.getByRole('button', { name: '첫 버튼' })).toHaveFocus()
  })

  it('keeps Tab inside the sheet', async () => {
    const { user } = renderSheet()
    const first = screen.getByRole('button', { name: '첫 버튼' })
    const last = screen.getByRole('button', { name: '마지막 버튼' })

    last.focus()
    await user.tab()
    expect(first).toHaveFocus()

    await user.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('closes on Escape and on a tap outside', async () => {
    const { onClose, user } = renderSheet()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '시트 닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('restores focus to the opener when it closes', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <>
        <button type="button">시트 열기</button>
        <BottomSheet onClose={onClose} open={false} title="족보 선택">
          <button type="button">첫 버튼</button>
        </BottomSheet>
      </>,
    )

    const opener = screen.getByRole('button', { name: '시트 열기' })
    opener.focus()

    rerender(
      <>
        <button type="button">시트 열기</button>
        <BottomSheet onClose={onClose} open title="족보 선택">
          <button type="button">첫 버튼</button>
        </BottomSheet>
      </>,
    )
    expect(opener).not.toHaveFocus()

    rerender(
      <>
        <button type="button">시트 열기</button>
        <BottomSheet onClose={onClose} open={false} title="족보 선택">
          <button type="button">첫 버튼</button>
        </BottomSheet>
      </>,
    )
    expect(opener).toHaveFocus()
  })

  it('시트를 충분히 아래로 끌면 닫는다', () => {
    const { onClose } = renderSheet()
    const handle = handleOf()

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  /*
   * 아래 드래그 테스트들은 "닫히는가"만 본다. 시트가 손가락을 따라 얼마나 내려갔는지는
   * transform으로 드러나는데, 그 속성은 이제 motion이 소유하고 jsdom에는 애니메이션
   * 프레임이 없어 항상 `none`으로 남는다 — 여기서 단정하면 늘 통과하는 빈 테스트가 된다.
   * 이동량 자체는 실기기·Playwright 시각 검토의 몫이다.
   */
  it('살짝만 끌면 닫지 않고 제자리로 돌린다', () => {
    const { onClose } = renderSheet()
    const handle = handleOf()

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 130, pointerId: 1 })

    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(onClose).not.toHaveBeenCalled()
  })

  // 위로 끄는 동작은 시트를 화면 밖으로 밀어 올려 버리면 안 된다.
  it('위로 끄는 동작은 시트를 따라 올리지 않는다', () => {
    const { onClose } = renderSheet()
    const handle = handleOf()

    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 })

    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('누르지 않은 채 지나간 포인터 이동은 무시한다', () => {
    const { onClose } = renderSheet()
    const handle = handleOf()

    fireEvent.pointerMove(handle, { clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(onClose).not.toHaveBeenCalled()
  })

  // 포인터가 시스템에 가로채여도 드래그 상태가 남으면 다음 탭이 오작동한다 —
  // 취소는 놓기와 같은 마무리를 거친다(임계값을 넘긴 채 취소되면 닫힘).
  it('포인터가 취소돼도 드래그 상태를 남기지 않는다', () => {
    const { onClose } = renderSheet()
    const handle = handleOf()

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 })
    fireEvent.pointerCancel(handle, { pointerId: 1 })
    expect(onClose).toHaveBeenCalledTimes(1)

    // 남은 offset이 없으므로 이어지는 이동은 무시된다.
    fireEvent.pointerMove(handle, { clientY: 900, pointerId: 1 })
  })

  // aria-modal만으로는 스크린리더가 뒤 화면으로 새어 나간다 — inert·스크롤 잠금이 함께 필요하다.
  it('열려 있는 동안 뒤 화면을 무력화하고 닫으면 되돌린다', () => {
    const background = document.createElement('main')
    document.body.append(background)

    const { rerender } = render(
      <BottomSheet onClose={vi.fn()} open={false} title="족보 선택">
        <button type="button">첫 버튼</button>
      </BottomSheet>,
    )
    expect(background).not.toHaveAttribute('inert')

    rerender(
      <BottomSheet onClose={vi.fn()} open title="족보 선택">
        <button type="button">첫 버튼</button>
      </BottomSheet>,
    )
    expect(background).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <BottomSheet onClose={vi.fn()} open={false} title="족보 선택">
        <button type="button">첫 버튼</button>
      </BottomSheet>,
    )
    expect(background).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')

    background.remove()
  })

  // 시트가 비어 있을 수도 있다(로딩 중) — 그때 Tab이 예외로 죽으면 화면 전체가 멈춘다.
  it('포커스할 것이 없는 시트에서도 Tab이 깨지지 않는다', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BottomSheet className="h-1/2" onClose={onClose} open title="족보 선택">
        <p>불러오는 중</p>
      </BottomSheet>,
    )

    await user.keyboard('{Tab}')
    expect(screen.getByRole('dialog', { name: '족보 선택' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
