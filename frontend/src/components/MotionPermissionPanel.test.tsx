import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MotionPermissionPanel } from './MotionPermissionPanel'

describe('MotionPermissionPanel', () => {
  it('lets the player dismiss the permission prompt', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <MotionPermissionPanel
        availability="permissionRequired"
        onClose={onClose}
        onRequestPermission={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '센서 안내 닫기' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // denied·error·insecure는 되돌릴 수 없는 상태라, 닫지 못하면 주사위 화면을 영구히 가린다.
  it('lets the player dismiss a terminal notice', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <MotionPermissionPanel
        availability="denied"
        onClose={onClose}
        onRequestPermission={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '센서 안내 닫기' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
