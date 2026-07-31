import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RollCounter } from './RollCounter'

describe('RollCounter', () => {
  // 도트는 aria-hidden이라 남은 횟수를 세는 유일한 수단이 이 문구다.
  it('남은 굴리기 횟수를 문구로 함께 알린다', () => {
    render(<RollCounter rollsUsed={1} />)

    expect(screen.getByText('2회 남음')).toBeVisible()
  })

  it('다 쓰면 남은 횟수 대신 소진을 알린다', () => {
    render(<RollCounter rollsUsed={3} />)

    expect(screen.getByText('굴림 소진')).toBeVisible()
    expect(screen.queryByText(/회 남음/)).not.toBeInTheDocument()
  })

  // 서버가 보낸 rollsUsed가 상한을 넘어도 "남은 -1회"처럼 깨져 보이면 안 된다.
  it('상한을 넘긴 사용 횟수도 소진으로 수렴한다', () => {
    render(<RollCounter rollsUsed={5} />)

    expect(screen.getByText('굴림 소진')).toBeVisible()
  })

  it('굴리기 상한이 바뀌면 남은 횟수도 그 상한을 따른다', () => {
    render(<RollCounter className="ml-2" maxRolls={5} rollsUsed={1} />)

    expect(screen.getByText('4회 남음')).toBeVisible()
  })
})
