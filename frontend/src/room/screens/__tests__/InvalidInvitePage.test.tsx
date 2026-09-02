import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidInvitePage } from '@/room/screens/InvalidInvitePage'
import { navigateSpy } from '@/test/routerDouble'

vi.mock('@tanstack/react-router', async () =>
  (await import('@/test/routerDouble')).routerWithNavigateSpy(),
)

/** 잘못된 코드로 막힌 화면에서 코드를 고쳐 다시 참가를 누른다. */
async function retryWithCode(typed: string) {
  const user = userEvent.setup()
  render(<InvalidInvitePage initialCode="BAD!" />)
  const input = screen.getByRole('textbox', { name: '초대 코드' })

  await user.clear(input)
  await user.type(input, typed)
  await user.click(screen.getByRole('button', { name: '수정한 코드로 참가' }))
}

describe('InvalidInvitePage', () => {
  beforeEach(() => navigateSpy.mockReset())

  it('잘못된 코드를 그대로 보여 주고 무엇이 문제인지 설명한다', () => {
    render(<InvalidInvitePage initialCode="BAD!" />)

    expect(screen.getByRole('textbox', { name: '초대 코드' })).toHaveValue('BAD!')
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('고친 코드가 형식에 맞으면 그 코드로 참가 흐름을 다시 시작한다', async () => {
    await retryWithCode(' yorr64 ')

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/join', search: { code: 'YORR64' } })
  })

  it('여전히 형식에 맞지 않으면 이동하지 않고 이유를 남긴다', async () => {
    await retryWithCode('ab')

    expect(navigateSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('막다른 길이 되지 않도록 뒤로 가기와 홈으로가 모두 홈을 향한다', async () => {
    const user = userEvent.setup()
    render(<InvalidInvitePage initialCode="BAD!" />)

    await user.click(screen.getByRole('button', { name: '뒤로 가기' }))
    await user.click(screen.getByRole('button', { name: '홈으로' }))

    expect(navigateSpy).toHaveBeenNthCalledWith(1, { to: '/' })
    expect(navigateSpy).toHaveBeenNthCalledWith(2, { to: '/' })
  })
})
