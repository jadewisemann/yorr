import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LandingGame } from '@/landingGames'
import { LandingHeroCopy } from './LandingHeroCopy'

const yacht: LandingGame = {
  duration: '한 판 4–5분',
  key: 'yacht',
  live: true,
  name: '요트 다이스',
  players: '1–6인',
}
const upcoming: LandingGame = { ...yacht, key: 'liars', live: false, name: '라이어스 다이스' }

describe('LandingHeroCopy', () => {
  it('선택된 게임 이름을 화면의 제목으로 삼는다', () => {
    render(<LandingHeroCopy game={yacht} layout="wide" />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('요트 다이스')
  })

  it('플레이 가능 여부를 배지 문구로 구분한다', () => {
    render(<LandingHeroCopy game={yacht} layout="wide" />)

    expect(screen.getByText('지금 플레이 가능')).toBeVisible()
    expect(screen.queryByText('준비 중')).not.toBeInTheDocument()
  })

  it('미공개 게임은 준비 중으로 알린다', () => {
    render(<LandingHeroCopy game={upcoming} layout="wide" />)

    expect(screen.getByText('준비 중')).toBeVisible()
    expect(screen.queryByText('지금 플레이 가능')).not.toBeInTheDocument()
  })

  it('인원·소요 시간을 한 줄 메타로 합쳐 보여 준다', () => {
    render(<LandingHeroCopy game={yacht} layout="wide" />)

    expect(screen.getByText('1–6인 · 한 판 4–5분')).toBeVisible()
  })

  // 데스크톱 히어로와 모바일 시트는 크기만 다르다 — 읽히는 내용은 같아야 한다.
  it('좁은 레이아웃에서도 같은 내용을 전달한다', () => {
    render(<LandingHeroCopy game={yacht} layout="narrow" />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('요트 다이스')
    expect(screen.getByText('지금 플레이 가능')).toBeVisible()
    expect(screen.getByText('1–6인 · 한 판 4–5분')).toBeVisible()
  })
})
