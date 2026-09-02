import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { navigateSpy } from '@/test/routerDouble'
import { TutorialPage } from '@/yacht/screens/TutorialPage'

vi.mock('@tanstack/react-router', async () =>
  (await import('@/test/routerDouble')).routerWithNavigateSpy(),
)

vi.mock(
  '@/yacht/input/useMotionRollInput',
  () => import('@/yacht/input/__tests__/motionRollInputDouble'),
)

vi.mock('@/yacht/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: () => <div data-testid="dice-scene" />,
}))

describe('TutorialPage', () => {
  beforeEach(() => {
    navigateSpy.mockReset()
    useAppStore.setState({ connectionStatus: 'idle' })
  })

  it('실전과 같은 플레이 화면 위에 연습 안내를 얹어 시작한다', () => {
    render(<TutorialPage />)

    expect(screen.getByTestId('dice-scene')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '요트 다이스가 처음이신가요?' })).toBeVisible()
  })

  it('연결이 없는 화면이지만 조작이 잠기지 않도록 연결됨으로 둔다', () => {
    render(<TutorialPage />)

    expect(useAppStore.getState().connectionStatus).toBe('connected')
  })

  it('화면을 벗어나면 연결 상태를 되돌린다 — 실전이 끊긴 소켓을 연결됨으로 착각하면 안 된다', () => {
    const view = render(<TutorialPage />)

    view.unmount()

    expect(useAppStore.getState().connectionStatus).toBe('idle')
  })

  it('첫 진입 코치마크는 띄우지 않는다 — 안내가 두 겹이면 어느 쪽을 따를지 알 수 없다', () => {
    render(<TutorialPage />)

    expect(screen.queryByRole('button', { name: '안내 닫기' })).not.toBeInTheDocument()
  })

  it('그만두면 랜딩으로 돌아간다', async () => {
    const user = userEvent.setup()
    render(<TutorialPage />)

    await user.click(screen.getByRole('button', { name: '연습 그만두기' }))

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/' })
  })
})
