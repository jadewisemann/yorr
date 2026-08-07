import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { mockApiServer } from '@/mocks/server'
import { useAppStore } from '@/store'
import { renderAppHarness, resetAppTestState } from '@/test/harness'

const lobbyPath = `/rooms/${creatorSession.roomId}/lobby`

describe('RoomExitGuard', () => {
  afterEach(() => resetAppTestState())

  it('방 밖으로 나가려는 이동을 가로채 확인을 받고, 머무르기를 고르면 방에 남는다', async () => {
    const { router, user } = renderAppHarness({
      initialPath: lobbyPath,
      session: creatorSession,
    })
    await screen.findByRole('heading', { name: '대기실' })

    void router.navigate({ to: '/' })

    const dialog = await screen.findByRole('alertdialog', { name: '방에서 나갈까요?' })
    await user.click(await within(dialog).findByRole('button', { name: '머무르기' }))

    expect(router.state.location.pathname).toBe(lobbyPath)
    expect(useAppStore.getState().roomSession).not.toBeNull()
    expect(await screen.findByRole('heading', { name: '대기실' })).toBeVisible()
  })

  it('확인하면 퇴장 처리 후 원래 가려던 곳으로 마저 보낸다', async () => {
    const { router, user } = renderAppHarness({
      initialPath: lobbyPath,
      session: creatorSession,
    })
    await screen.findByRole('heading', { name: '대기실' })

    void router.navigate({ to: '/' })

    const dialog = await screen.findByRole('alertdialog', { name: '방에서 나갈까요?' })
    await user.click(await within(dialog).findByRole('button', { name: '나가기' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(useAppStore.getState().roomSession).toBeNull()
  })

  it('퇴장 REST가 실패해도 로컬 세션을 정리한다', async () => {
    mockApiServer.use(
      http.delete('/api/v1/rooms/:roomCode/players/me', () =>
        HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 }),
      ),
    )
    const { router, user } = renderAppHarness({
      initialPath: lobbyPath,
      session: creatorSession,
    })
    await screen.findByRole('heading', { name: '대기실' })

    void router.navigate({ to: '/' })
    const dialog = await screen.findByRole('alertdialog', { name: '방에서 나갈까요?' })
    await user.click(await within(dialog).findByRole('button', { name: '나가기' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(useAppStore.getState().roomSession).toBeNull()
  })

  it('같은 방 안의 화면 전환(대기실 → 게임)은 막지 않는다', async () => {
    const { router } = renderAppHarness({
      initialPath: lobbyPath,
      session: { ...creatorSession, snapshot: creatorSession.snapshot },
    })
    await screen.findByRole('heading', { name: '대기실' })

    void router.navigate({
      to: '/rooms/$roomId/game',
      params: { roomId: creatorSession.roomId },
    })

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/rooms/${creatorSession.roomId}/game`),
    )
    expect(screen.queryByRole('alertdialog', { name: '방에서 나갈까요?' })).not.toBeInTheDocument()
  })
})
