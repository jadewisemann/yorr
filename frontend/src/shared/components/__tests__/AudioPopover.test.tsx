import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioPopover } from '../AudioPopover'

function renderPopover(muted: boolean) {
  render(<AudioPopover muted={muted} onClose={vi.fn()} onToggleMute={vi.fn()} open={true} />)
}

describe('AudioPopover', () => {
  it('음소거 중에는 슬라이더가 조작 불가이고 값 대신 음소거라고 적는다', () => {
    renderPopover(true)

    for (const label of ['배경음 볼륨', '효과음 볼륨']) {
      const slider = screen.getByLabelText(label)
      expect(slider).toBeDisabled()
      expect(slider).toHaveAttribute('aria-valuetext', '음소거')
    }
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
    expect(screen.getAllByText('음소거')).toHaveLength(2)
  })

  it('소리가 켜져 있으면 슬라이더로 조절할 수 있다', () => {
    renderPopover(false)

    const slider = screen.getByLabelText('배경음 볼륨')
    expect(slider).toBeEnabled()
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('퍼센트'))
  })
})
