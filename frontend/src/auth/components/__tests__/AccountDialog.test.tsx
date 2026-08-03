import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountDialog } from '@/auth/components/AccountDialog'
import { API_BASE_URL } from '@/shared/api/client'
import { resetAppTestState } from '@/test/harness'

/**
 * 제공자 버튼은 fetch가 아니라 전체 페이지 이동이라 jsdom에서 그대로 두면
 * "Not implemented: navigation"만 남고 어디로 보냈는지 검증할 수 없다. assign을 갈아
 * 목적지를 받아 본다.
 */
function stubNavigation() {
  const assign = vi.fn()
  vi.stubGlobal('location', { ...globalThis.location, assign })
  return assign
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetAppTestState()
})

const session = { userId: 'u1', nickname: '느긋한 선장', sessionToken: 'token-1' }

describe('로그인 수단 고르기', () => {
  it('제공자마다 그 제공자의 시작 주소로 페이지를 옮긴다', async () => {
    const assign = stubNavigation()
    const user = userEvent.setup()
    render(
      <AccountDialog layout="wide" onClose={vi.fn()} onSignOut={vi.fn()} open session={null} />,
    )

    await user.click(screen.getByRole('button', { name: '카카오로 계속하기' }))
    expect(assign).toHaveBeenCalledWith(`${API_BASE_URL}/auth/kakao/authorize`)

    await user.click(screen.getByRole('button', { name: '구글로 계속하기' }))
    expect(assign).toHaveBeenCalledWith(`${API_BASE_URL}/auth/google/authorize`)
  })

  it('다른 계정으로 로그인은 재인증을 요청한다 — 카카오 세션이 남아 동의 없이 통과하기 때문이다', async () => {
    const assign = stubNavigation()
    const user = userEvent.setup()
    render(
      <AccountDialog layout="wide" onClose={vi.fn()} onSignOut={vi.fn()} open session={null} />,
    )

    await user.click(screen.getByRole('button', { name: '다른 계정으로 로그인' }))

    expect(assign).toHaveBeenCalledWith(`${API_BASE_URL}/auth/kakao/authorize?prompt=login`)
  })
})

describe('닉네임 편집', () => {
  async function openEditor() {
    const user = userEvent.setup()
    render(
      <AccountDialog layout="wide" onClose={vi.fn()} onSignOut={vi.fn()} open session={session} />,
    )
    await user.click(screen.getByRole('button', { name: '프로필 관리' }))
    return user
  }

  it('빈 이름은 서버에 보내지 않고 이유를 알려준다', async () => {
    const user = await openEditor()

    await user.clear(screen.getByLabelText('닉네임'))
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('닉네임을 입력해 주세요.')
    // 편집 화면에 머문다 — 고칠 기회를 빼앗지 않는다.
    expect(screen.getByLabelText('닉네임')).toBeInTheDocument()
  })

  it('이름이 그대로면 요청 없이 편집만 닫는다', async () => {
    const user = await openEditor()

    await user.click(screen.getByRole('button', { name: '저장' }))

    // MSW가 onUnhandledRequest: 'error'라, 요청이 나갔다면 이 테스트가 먼저 터진다.
    expect(await screen.findByRole('button', { name: '프로필 관리' })).toBeInTheDocument()
  })
})
