import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LandingCodeDialog } from '@/landing/components/LandingCodeDialog'

function renderDialog(overrides: Partial<Parameters<typeof LandingCodeDialog>[0]> = {}) {
  const onClose = vi.fn()
  const onCodeChange = vi.fn()
  const onSubmit = vi.fn()
  const view = render(
    <LandingCodeDialog
      code=""
      layout="wide"
      onClose={onClose}
      onCodeChange={onCodeChange}
      onSubmit={onSubmit}
      open
      {...overrides}
    />,
  )
  return { onClose, onCodeChange, onSubmit, ...view }
}

describe('LandingCodeDialog', () => {
  it('narrow에서는 바텀시트로 뜬다', () => {
    renderDialog({ layout: 'narrow' })
    expect(screen.getByRole('dialog', { name: '초대받은 방에 참가' })).toBeVisible()
  })

  it('wide에서는 팝오버로 뜨고 코드 입력에 포커스를 준다', () => {
    renderDialog({ layout: 'wide' })

    // 진입 애니메이션은 motion이 그리는데 jsdom에는 WAAPI가 없어 요소가 initial(opacity 0)에
    // 멈춘다 — toBeVisible()은 실제 가시성이 아니라 그 사실만 잡게 된다. "열렸는가"는
    // 존재와 포커스로 본다.
    const dialog = screen.getByRole('dialog', { name: '초대받은 방에 참가' })
    expect(dialog).toBeInTheDocument()
    expect(dialog.querySelector('input')).toHaveFocus()
  })

  it('open이 false면 wide 팝오버는 아예 그리지 않는다', () => {
    renderDialog({ layout: 'wide', open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('배경을 누르면 닫힌다', () => {
    const { onClose } = renderDialog({ layout: 'wide' })

    fireEvent.click(screen.getByRole('button', { name: '배경을 눌러 닫기' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape를 누르면 닫힌다', () => {
    const { onClose } = renderDialog({ layout: 'wide' })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })
})
