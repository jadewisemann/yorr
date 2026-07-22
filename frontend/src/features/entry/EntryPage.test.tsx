import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EntryPage } from './EntryPage'

describe('EntryPage', () => {
  it('offers a visible game start action', () => {
    render(<EntryPage />)

    expect(screen.getByRole('button', { name: '게임 시작' })).toBeVisible()
  })
})
