import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TurnStrip } from '@/yacht/components/TurnStrip'

describe('TurnStrip', () => {
  it('marks an offline player without removing their turn position', () => {
    render(
      <TurnStrip
        activePlayerId="player-online"
        players={[
          { nickname: '나', playerId: 'player-online', status: 'online', total: 18 },
          { nickname: '친구', playerId: 'player-offline', status: 'offline', total: 12 },
        ]}
        you="player-online"
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('친구')).toBeVisible()
    expect(screen.getByText('연결 끊김')).toBeVisible()
  })
})
