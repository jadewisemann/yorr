import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MOCK_ROOM_ID } from '@/mocks/fixtures'
import { useAppStore } from '@/store'
import { renderAppHarness } from '@/test/harness'

async function startQuickMatch() {
  const harness = renderAppHarness({ initialPath: '/join?game=yacht&mode=quick' })
  useAppStore.getState().signIn({
    userId: 'mock-member-id',
    nickname: '카카오회원',
    sessionToken: 'mock-member-token',
  })
  await harness.user.click(await screen.findByRole('button', { name: '상대 찾기' }))
  return harness
}

describe('빠른 대전 백드롭', () => {
  it('대기 상태를 보여주고, 매칭되면 방 세션을 만들어 대기실로 옮긴다', async () => {
    await startQuickMatch()

    expect(await screen.findByText('상대를 찾고 있어요')).toBeInTheDocument()

    await waitFor(() => expect(useAppStore.getState().roomSession?.roomId).toBe(MOCK_ROOM_ID), {
      timeout: 10_000,
    })
    expect(await screen.findByText('상대를 찾았어요 · 곧 시작해요')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '대기실' })).toBeInTheDocument()
  }, 20_000)

  it('취소하면 대기가 끝나고 백드롭이 사라진다', async () => {
    const { user } = await startQuickMatch()

    await user.click(await screen.findByRole('button', { name: '취소' }))

    await waitFor(() => expect(useAppStore.getState().quickMatch).toBeNull())
    expect(screen.queryByText('상대를 찾고 있어요')).not.toBeInTheDocument()
  }, 20_000)
})
