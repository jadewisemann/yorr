import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { EntryPage } from './EntryPage'

describe('EntryPage', () => {
  it('offers a visible game start action', () => {
    render(<EntryPage />)

    expect(screen.getByRole('button', { name: '게임 시작' })).toBeVisible()
  })

  it('creates a room through the feature hook and stores the server snapshot', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '게임 시작' }))

    expect(await screen.findByText('방 YORR64 생성됨')).toBeVisible()
    expect(useAppStore.getState().roomSnapshot?.roomId).toBe('room-yorr-64')
    expect(useAppStore.getState().roomSession).toEqual({
      roomId: 'room-yorr-64',
      roomCode: 'YORR64',
      you: 'player-host',
      sessionToken: 'session-host-64',
    })
  })
})
