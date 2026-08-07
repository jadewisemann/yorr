import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dice } from '@/yacht/components/Dice'

const values = [1, 2, 3, 4, 5, 6] as const

describe('Dice', () => {
  it('눈 개수가 주사위 값과 일치한다', () => {
    for (const value of values) {
      const { container, unmount } = render(<Dice value={value} />)
      expect(container.querySelectorAll('span')).toHaveLength(value)
      unmount()
    }
  })

  it('값을 접근 가능한 이름으로 읽어 준다', () => {
    render(<Dice value={4} />)

    expect(screen.getByRole('img', { name: '주사위 4' })).toBeVisible()
  })

  it('킵된 주사위는 이름에 킵됨을 덧붙인다', () => {
    render(<Dice held value={4} />)

    expect(screen.getByRole('img', { name: '주사위 4, 킵됨' })).toBeVisible()
  })

  it('굴리는 중이거나 크기가 달라도 읽히는 이름은 그대로다', () => {
    const { rerender } = render(<Dice rolling size="lg" value={6} />)
    expect(screen.getByRole('img', { name: '주사위 6' })).toBeVisible()

    rerender(<Dice className="opacity-50" size="sm" value={6} />)
    expect(screen.getByRole('img', { name: '주사위 6' })).toBeVisible()
  })
})
