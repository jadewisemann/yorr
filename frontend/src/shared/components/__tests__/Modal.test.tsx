import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '@/shared/components/Modal'

function renderModal(onClose = vi.fn()) {
  const view = render(
    <Modal onClose={onClose} open title="0점으로 확정할까요?">
      <button type="button">확정</button>
    </Modal>,
  )
  return { ...view, onClose, user: userEvent.setup() }
}

describe('Modal', () => {
  it('닫혀 있으면 아무것도 그리지 않는다', () => {
    render(
      <Modal onClose={vi.fn()} open={false} title="0점으로 확정할까요?">
        <button type="button">확정</button>
      </Modal>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('제목으로 이름 붙은 모달 다이얼로그다', () => {
    renderModal()

    expect(screen.getByRole('dialog', { name: '0점으로 확정할까요?' })).toHaveAttribute(
      'aria-modal',
      'true',
    )
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('0점으로 확정할까요?')
  })

  it('열리면 닫기 버튼으로 포커스를 옮긴다', () => {
    renderModal()

    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus()
  })

  it('Escape · 닫기 버튼 · 바깥 탭 모두 같은 닫기 동작이다', async () => {
    const { onClose, user } = renderModal()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: '모달 닫기' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('부모가 새 onClose를 넘겨도 포커스를 다시 빼앗지 않는다', async () => {
    const { rerender, user } = renderModal()
    const confirm = screen.getByRole('button', { name: '확정' })

    confirm.focus()
    rerender(
      <Modal onClose={vi.fn()} open title="0점으로 확정할까요?">
        <button type="button">확정</button>
      </Modal>,
    )
    expect(confirm).toHaveFocus()

    const latestClose = vi.fn()
    rerender(
      <Modal onClose={latestClose} open title="0점으로 확정할까요?">
        <button type="button">확정</button>
      </Modal>,
    )
    await user.keyboard('{Escape}')
    expect(latestClose).toHaveBeenCalledTimes(1)
  })

  it('닫히면 열기 버튼으로 포커스를 되돌린다', () => {
    const { rerender } = render(
      <>
        <button type="button">0점 확정 열기</button>
        <Modal onClose={vi.fn()} open={false} title="0점으로 확정할까요?">
          <button type="button">확정</button>
        </Modal>
      </>,
    )
    const opener = screen.getByRole('button', { name: '0점 확정 열기' })
    opener.focus()

    rerender(
      <>
        <button type="button">0점 확정 열기</button>
        <Modal onClose={vi.fn()} open title="0점으로 확정할까요?">
          <button type="button">확정</button>
        </Modal>
      </>,
    )
    expect(opener).not.toHaveFocus()

    rerender(
      <>
        <button type="button">0점 확정 열기</button>
        <Modal onClose={vi.fn()} open={false} title="0점으로 확정할까요?">
          <button type="button">확정</button>
        </Modal>
      </>,
    )
    expect(opener).toHaveFocus()
  })

  it('열려 있는 동안 뒤 화면을 무력화하고 닫으면 되돌린다', () => {
    const background = document.createElement('main')
    document.body.append(background)

    const { rerender } = render(
      <Modal onClose={vi.fn()} open={false} title="0점으로 확정할까요?">
        <button type="button">확정</button>
      </Modal>,
    )
    expect(background).not.toHaveAttribute('inert')

    rerender(
      <Modal onClose={vi.fn()} open title="0점으로 확정할까요?">
        <button type="button">확정</button>
      </Modal>,
    )
    expect(background).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <Modal onClose={vi.fn()} open={false} title="0점으로 확정할까요?">
        <button type="button">확정</button>
      </Modal>,
    )
    expect(background).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')

    background.remove()
  })
})
