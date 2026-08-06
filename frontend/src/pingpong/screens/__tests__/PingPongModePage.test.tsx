import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PingPongModePage } from '@/pingpong/screens/PingPongModePage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

describe('@/pingpong/screens/PingPongModePage', () => {
  beforeEach(() => navigate.mockReset())

  it('starts the AI match immediately without a difficulty step', () => {
    render(<PingPongModePage />)

    expect(screen.getByLabelText('로컬 3D 탁구 코트')).toBeInTheDocument()
    expect(screen.getByText('AI와 대전')).toBeVisible()
    expect(screen.queryByText('난이도 선택')).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('returns from the AI match to game selection', async () => {
    const user = userEvent.setup()
    render(<PingPongModePage />)

    await user.click(screen.getByRole('button', { name: '게임 선택' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })
})
