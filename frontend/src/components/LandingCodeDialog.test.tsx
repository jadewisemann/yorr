import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LandingCodeDialog } from './LandingCodeDialog'

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

    const dialog = screen.getByRole('dialog', { name: '초대받은 방에 참가' })
    expect(dialog).toBeVisible()
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
