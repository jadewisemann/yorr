import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MotionPermissionPanel } from '@/yacht/components/MotionPermissionPanel'

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

  // 센서값을 서버로 보내지 않는다는 점은 권한을 누르기 전에 읽혀야 한다.
  it('권한을 요청하기 전에 센서 사용 범위를 밝힌다', () => {
    render(
      <MotionPermissionPanel
        availability="permissionRequired"
        onClose={vi.fn()}
        onRequestPermission={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      '모션 센서를 사용해 볼까요?',
    )
    expect(screen.getByText(/서버로 보내지 않아요/)).toBeVisible()
  })

  it('시작 버튼을 누르면 권한 요청으로 이어진다', async () => {
    const user = userEvent.setup()
    const onRequestPermission = vi.fn().mockResolvedValue(undefined)
    render(
      <MotionPermissionPanel
        availability="permissionRequired"
        onClose={vi.fn()}
        onRequestPermission={onRequestPermission}
      />,
    )

    await user.click(screen.getByRole('button', { name: '센서 사용 시작하기' }))

    expect(onRequestPermission).toHaveBeenCalledTimes(1)
  })

  // 권한 창이 떠 있는 동안 다시 누르면 요청이 겹친다.
  it('권한 확인 중에는 다시 요청할 수 없다', async () => {
    const user = userEvent.setup()
    const onRequestPermission = vi.fn().mockResolvedValue(undefined)
    render(
      <MotionPermissionPanel
        availability="requesting"
        onClose={vi.fn()}
        onRequestPermission={onRequestPermission}
      />,
    )

    const button = screen.getByRole('button', { name: '권한 확인 중' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    await user.click(button)
    expect(onRequestPermission).not.toHaveBeenCalled()
  })

  // 되돌릴 수 없는 상태에서 "다시 시도" 버튼을 남기면 눌러도 아무 일이 없다.
  it('되돌릴 수 없는 상태에서는 다음 할 일만 안내하고 요청 버튼을 감춘다', () => {
    const { rerender } = render(
      <MotionPermissionPanel
        availability="denied"
        onClose={vi.fn()}
        onRequestPermission={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: '센서 권한 안내' })).toBeVisible()
    expect(screen.getByText(/센서 권한이 거부됐어요/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '센서 사용 시작하기' })).not.toBeInTheDocument()

    rerender(
      <MotionPermissionPanel
        availability="insecure"
        onClose={vi.fn()}
        onRequestPermission={vi.fn()}
      />,
    )
    expect(screen.getByText(/HTTPS로 접속했을 때만/)).toBeVisible()

    rerender(
      <MotionPermissionPanel
        availability="error"
        onClose={vi.fn()}
        onRequestPermission={vi.fn()}
      />,
    )
    expect(screen.getByText(/센서 권한을 시작하지 못했어요/)).toBeVisible()
  })
})
