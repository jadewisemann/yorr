import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EntryPage } from './EntryPage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

describe('EntryPage', () => {
  beforeEach(() => navigate.mockReset())

  it('offers room creation and invite-code entry', () => {
    render(<EntryPage />)

    expect(screen.getByRole('button', { name: '방 만들기' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '초대 코드' })).toBeVisible()
    expect(screen.getByRole('button', { name: '코드로 참가' })).toBeVisible()
  })

  it('opens nickname entry for a new room', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '방 만들기' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: undefined } })
  })

  it('normalizes a valid invite code and explains an invalid code', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)
    const input = screen.getByRole('textbox', { name: '초대 코드' })

    await user.type(input, 'bad!')
    await user.click(screen.getByRole('button', { name: '코드로 참가' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '초대 코드는 영문과 숫자 4~12자로 입력해 주세요.',
    )

    await user.clear(input)
    await user.type(input, ' yorr64 ')
    await user.click(screen.getByRole('button', { name: '코드로 참가' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: 'YORR64' } })
  })
})
