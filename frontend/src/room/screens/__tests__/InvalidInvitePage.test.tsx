import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidInvitePage } from '@/room/screens/InvalidInvitePage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

describe('InvalidInvitePage', () => {
  beforeEach(() => navigate.mockReset())

  it('잘못된 코드를 그대로 보여 주고 무엇이 문제인지 설명한다', () => {
    render(<InvalidInvitePage initialCode="BAD!" />)

    expect(screen.getByRole('textbox', { name: '초대 코드' })).toHaveValue('BAD!')
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('고친 코드가 형식에 맞으면 그 코드로 참가 흐름을 다시 시작한다', async () => {
    const user = userEvent.setup()
    render(<InvalidInvitePage initialCode="BAD!" />)
    const input = screen.getByRole('textbox', { name: '초대 코드' })

    await user.clear(input)
    await user.type(input, ' yorr64 ')
    await user.click(screen.getByRole('button', { name: '수정한 코드로 참가' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: 'YORR64' } })
  })

  it('여전히 형식에 맞지 않으면 이동하지 않고 이유를 남긴다', async () => {
    const user = userEvent.setup()
    render(<InvalidInvitePage initialCode="BAD!" />)
    const input = screen.getByRole('textbox', { name: '초대 코드' })

    await user.clear(input)
    await user.type(input, 'ab')
    await user.click(screen.getByRole('button', { name: '수정한 코드로 참가' }))

    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('막다른 길이 되지 않도록 뒤로 가기와 홈으로가 모두 홈을 향한다', async () => {
    const user = userEvent.setup()
    render(<InvalidInvitePage initialCode="BAD!" />)

    await user.click(screen.getByRole('button', { name: '뒤로 가기' }))
    await user.click(screen.getByRole('button', { name: '홈으로' }))

    expect(navigate).toHaveBeenNthCalledWith(1, { to: '/' })
    expect(navigate).toHaveBeenNthCalledWith(2, { to: '/' })
  })
})
