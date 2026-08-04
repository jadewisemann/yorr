import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PingPongModePage } from '../PingPongModePage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

describe('PingPongModePage', () => {
  beforeEach(() => navigate.mockReset())

  it('offers bot, phone party, and online modes', () => {
    render(<PingPongModePage />)

    expect(screen.getByRole('button', { name: '쉬움' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '보통' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '어려움' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /1:1 파티 모드/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /온라인 모드/ })).toBeEnabled()
  })

  it('opens a ping pong party room for two phone controllers', async () => {
    const user = userEvent.setup()
    render(<PingPongModePage />)

    await user.click(screen.getByRole('button', { name: /1:1 파티 모드/ }))

    expect(navigate).toHaveBeenCalledWith({ to: '/party', search: { game: 'pingpong' } })
  })

  it('keeps online play on the existing YORR room flow', async () => {
    const user = userEvent.setup()
    render(<PingPongModePage />)

    await user.click(screen.getByRole('button', { name: /온라인 모드/ }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/join',
      search: { code: undefined, game: 'pingpong' },
    })
  })
})
