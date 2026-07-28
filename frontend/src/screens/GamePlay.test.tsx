import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayingRoomSnapshot, creatorSession } from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { PhysicsDiceRollRequest, PhysicsDiceSet } from '@/rendering/physics-dice/types'
import { useAppStore } from '@/store'
import { GamePlay } from './GamePlay'

/**
 * 물리 렌더러는 rAF와 WebGL에 의존해 jsdom에서 굴림을 끝낼 수 없다.
 * 굴림 완료를 버튼으로 노출해 CTA 상태 전이만 결정적으로 검증한다.
 */
vi.mock('@/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: ({
    onHeldToggle,
    onRollComplete,
    request,
  }: {
    onHeldToggle?: (index: 0) => void
    onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
    request: PhysicsDiceRollRequest | null
  }) => (
    <div>
      {request && (
        <button onClick={() => onRollComplete(request.requestId, [6, 5, 4, 3, 2])} type="button">
          굴림 완료
        </button>
      )}
      <button onClick={() => onHeldToggle?.(0)} type="button">
        첫 주사위 킵
      </button>
    </div>
  ),
}))

const { snapshot: _snapshot, ...session } = creatorSession

function renderGame() {
  const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  return {
    ...render(
      <RealtimeClientProvider client={createRealtimeFixture()}>
        <GamePlay roomId={session.roomId} session={session} snapshot={snapshot} />
      </RealtimeClientProvider>,
    ),
    user: userEvent.setup(),
  }
}

describe('GamePlay', () => {
  beforeEach(() => useAppStore.getState().reset())

  it('keeps the primary CTA to roll and confirm only', async () => {
    const { user } = renderGame()

    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '굴리기' }))

    // 굴리는 동안에도 버튼은 같은 자리에 남고 라벨만 바뀐다.
    expect(screen.getByRole('button', { name: '굴리는 중' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    expect(screen.getByText('굴림 2회 남음')).toBeVisible()
  })

  it('shows recommended categories once dice have settled', async () => {
    const { user } = renderGame()

    expect(screen.getByText('주사위를 굴리면 추천 족보가 나타납니다')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    expect(screen.getByText('최고 점수')).toBeVisible()
    expect(screen.getAllByText('사용 가능')).toHaveLength(2)
  })

  it('opens the category sheet automatically after the last roll', async () => {
    const { user } = renderGame()

    for (let roll = 0; roll < 3; roll += 1) {
      await user.click(screen.getByRole('button', { name: '굴리기' }))
      await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    }

    expect(screen.getByText('굴림 소진')).toBeVisible()
    const sheet = await screen.findByRole('dialog', { name: '족보 선택' })
    expect(within(sheet).getByRole('heading', { name: '족보 선택' })).toBeVisible()
    expect(screen.getByRole('button', { name: '확정하기' })).toBeDisabled()
  })

  it('records the chosen category and then waits for the other players', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: `전체 12개 ▸` }))

    const sheet = await screen.findByRole('dialog', { name: '족보 선택' })
    await user.click(within(sheet).getByRole('button', { name: /^Choice/ }))
    await user.click(within(sheet).getByRole('button', { name: /Choice에 \d+점 확정/ }))

    expect(await screen.findByText(/명 완료 · 다음 라운드를 기다리는 중/)).toBeVisible()
  })

  it('asks for confirmation before recording a zero', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '전체 12개 ▸' }))

    const sheet = await screen.findByRole('dialog', { name: '족보 선택' })
    const zeroRow = within(sheet)
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-label')?.endsWith(' 0'))
    expect(zeroRow).toBeDefined()
    if (!zeroRow) return

    await user.click(zeroRow)
    await user.click(within(sheet).getByRole('button', { name: /0점 확정$/ }))

    expect(await screen.findByRole('dialog', { name: /0점으로 확정할까요\?/ })).toBeVisible()
  })
})
