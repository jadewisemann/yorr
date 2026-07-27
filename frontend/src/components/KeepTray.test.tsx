import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DiceSet, HeldDice } from '@/domain/dice'
import { KeepTray } from './KeepTray'

const dice: DiceSet = [2, 4, 6, 1, 3]
const heldTwoAndThree: HeldDice = [false, true, true, false, false]
const nothingHeld: HeldDice = [false, false, false, false, false]

describe('KeepTray', () => {
  it('explains the empty tray instead of showing a bare box', () => {
    render(<KeepTray dice={dice} held={nothingHeld} />)

    expect(screen.getByText('아직 남긴 주사위가 없어요')).toBeVisible()
    expect(screen.getByLabelText('남긴 주사위 0개')).toBeVisible()
  })

  it('lifts only the held dice into the tray and counts them', () => {
    render(<KeepTray dice={dice} held={heldTwoAndThree} />)

    expect(screen.getByText('KEEP · 남긴 주사위 2')).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '주사위 4, 남김 해제' })).toBeVisible()
  })

  it('releases a die back to the pool when tapped', async () => {
    const onRelease = vi.fn()
    const user = userEvent.setup()
    render(<KeepTray dice={dice} held={heldTwoAndThree} onRelease={onRelease} />)

    await user.click(screen.getAllByRole('button')[0] as HTMLElement)

    expect(onRelease).toHaveBeenCalledWith(1)
  })

  it('locks the tray after the last roll and says why', async () => {
    const onRelease = vi.fn()
    const user = userEvent.setup()
    render(<KeepTray dice={dice} held={heldTwoAndThree} locked onRelease={onRelease} />)

    expect(screen.getByText('이번 라운드는 변경할 수 없어요')).toBeVisible()
    const die = screen.getAllByRole('button')[0] as HTMLElement
    expect(die).toBeDisabled()

    await user.click(die)
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('stays empty before the first roll', () => {
    render(<KeepTray dice={null} held={heldTwoAndThree} />)

    expect(screen.getByText('아직 남긴 주사위가 없어요')).toBeVisible()
  })
})
