import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from './BottomSheet'

function renderSheet(onClose = vi.fn()) {
  render(
    <BottomSheet onClose={onClose} open title="족보 선택">
      <button type="button">첫 버튼</button>
      <button type="button">마지막 버튼</button>
    </BottomSheet>,
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
})
