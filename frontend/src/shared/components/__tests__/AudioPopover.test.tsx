import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioPopover } from '../AudioPopover'

/**
 * 전체 음소거 중에 슬라이더가 "이만큼 들린다"로 읽히던 문제(50%에 손잡이가 있고 트랙이
 * 브랜드 색으로 차 있었다). 값을 0으로 덮어쓰지 않고 — 켰을 때 돌아갈 값이므로 —
 * 흐리게 + 조작 불가 + "음소거" 표기로 말한다.
 */

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
    // 퍼센트 표기가 남아 있으면 "지금 그 크기로 들린다"로 읽힌다.
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
