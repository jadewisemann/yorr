import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { NicknamePage } from './NicknamePage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

describe('NicknamePage', () => {
  beforeEach(() => {
    navigate.mockReset()
    useAppStore.getState().reset()
  })

  it('creates a room with the displayed suggestion when input is blank', async () => {
    const user = userEvent.setup()
    render(<NicknamePage />)
    const input = screen.getByRole('textbox', { name: '닉네임' })
    const suggestion = input.getAttribute('placeholder')

    await user.click(screen.getByRole('button', { name: '대기실 입장' }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(suggestion).toBeTruthy()
    expect(useAppStore.getState().roomSession).toMatchObject({
      roomId: 'YORR64',
      roomCode: 'YORR64',
      you: 'player-creator',
      nickname: suggestion,
      membershipRole: 'host',
      sessionToken: 'session-creator-64',
    })
    expect(useAppStore.getState().roomSnapshot).toBeNull()
    expect(navigate).toHaveBeenCalledWith({
      to: '/rooms/$roomId/lobby',
      params: { roomId: 'YORR64' },
    })
  })

  it('joins an invited room with the entered nickname', async () => {
    const user = userEvent.setup()
    render(<NicknamePage roomCode="YORR64" />)
    const input = screen.getByRole('textbox', { name: '닉네임' })

    await user.clear(input)
    await user.type(input, '수상한 선장')
    await user.click(screen.getByRole('button', { name: '대기실 입장' }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const state = useAppStore.getState()
    expect(state.roomSession).toMatchObject({
      roomCode: 'YORR64',
      membershipRole: 'participant',
      you: 'player-participant',
      nickname: '수상한 선장',
    })
    expect(state.roomSnapshot).toBeNull()
  })

  it('keeps invalid markup out of the request and explains the rule', async () => {
    const user = userEvent.setup()
    render(<NicknamePage />)
    const input = screen.getByRole('textbox', { name: '닉네임' })

    await user.clear(input)
    await user.type(input, '<script>')
    await user.click(screen.getByRole('button', { name: '대기실 입장' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '닉네임에는 문자, 숫자, 공백만 사용할 수 있어요.',
    )
    expect(navigate).not.toHaveBeenCalled()
  })
})
