import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { useAppStore } from '@/store'
import { RankingTicker } from '../RankingTicker'

type Entry = { rank: number; userId: string; nickname: string; bestScore: number }

function respondWith(entries: Entry[]) {
  mockApiServer.use(
    http.get('/api/v1/rankings/weekly', () =>
      HttpResponse.json({ weekStart: '2026-08-03', entries }),
    ),
  )
}

function signIn(userId: string) {
  useAppStore.getState().signIn({ nickname: '나', sessionToken: 'token-1', userId })
}

function myRankIs(rank: number | null) {
  mockApiServer.use(
    http.get('/api/v1/rankings/weekly/me', () =>
      rank === null
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json({ weekStart: '2026-08-03', rank, bestScore: 143 }),
    ),
  )
}

afterEach(() => {
  useAppStore.getState().signOut()
})

const first: Entry = { rank: 1, userId: 'u1', nickname: '일등', bestScore: 300 }
const second: Entry = { rank: 2, userId: 'u2', nickname: '이등', bestScore: 250 }
const twoEntries: Entry[] = [first, second]
const fiveEntries: Entry[] = [
  first,
  second,
  { rank: 3, userId: 'u3', nickname: '삼등', bestScore: 200 },
  { rank: 4, userId: 'u4', nickname: '사등', bestScore: 150 },
  { rank: 5, userId: 'u5', nickname: '오등', bestScore: 100 },
]

const sevenEntries: Entry[] = [
  ...fiveEntries,
  { rank: 6, userId: 'u6', nickname: '육등', bestScore: 90 },
  { rank: 7, userId: 'u7', nickname: '칠등', bestScore: 80 },
]

describe('RankingTicker · narrow', () => {
  it('순위·닉네임·점수를 보여준다', async () => {
    respondWith(twoEntries)
    render(<RankingTicker layout="narrow" />)

    const list = await screen.findByRole('list')
    expect(list).toHaveTextContent('1일등300점')
    expect(list).toHaveTextContent('2이등250점')
  })

  it('흐를 때 복제한 목록은 보조기기에서 감춘다', async () => {
    respondWith(fiveEntries)
    render(<RankingTicker layout="narrow" />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
    expect(screen.getAllByText('일등').length).toBeGreaterThan(1)
  })

  it('이동 거리가 정확히 한 벌 폭이다', async () => {
    respondWith(fiveEntries)
    render(<RankingTicker layout="narrow" />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))

    const track = screen.getAllByRole('listitem')[0]?.parentElement?.parentElement
    const copies = track?.childElementCount ?? 0
    const shift = Number(
      (track as HTMLElement).style.getPropertyValue('--ticker-shift').replace(/[-%]/g, ''),
    )

    expect(copies).toBeGreaterThan(1)
    expect(shift * copies).toBeCloseTo(100, 2)
  })

  it('한 명뿐이면 복제하지 않는다', async () => {
    respondWith([first])
    render(<RankingTicker layout="narrow" />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getAllByText('일등')).toHaveLength(1)
  })

  it('두 명이면 흐른다', async () => {
    respondWith(twoEntries)
    render(<RankingTicker layout="narrow" />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(screen.getAllByText('일등').length).toBeGreaterThan(1)
  })
})

describe('RankingTicker · wide', () => {
  it('흐르지 않고 상위 몇 명만 세워 둔다', async () => {
    respondWith(sevenEntries)
    render(<RankingTicker layout="wide" />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
    expect(screen.getAllByText('일등')).toHaveLength(1)
    expect(screen.queryByText('육등')).not.toBeInTheDocument()
  })

  it('남은 인원 수를 버튼에 적는다', async () => {
    respondWith(sevenEntries)
    render(<RankingTicker layout="wide" />)

    expect(await screen.findByRole('button', { name: /\+2명 전체 보기/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('펼치면 전체 순위가 열로 정렬돼 보인다', async () => {
    respondWith(sevenEntries)
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    const toggle = await screen.findByRole('button', { name: /전체 보기/ })
    await user.click(toggle)

    const panel = screen.getByRole('list', { name: '이번 주 순위' })
    expect(panel).toHaveTextContent('육등')
    expect(panel).toHaveTextContent('칠등')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('Escape로 닫힌다', async () => {
    respondWith(fiveEntries)
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    await user.click(await screen.findByRole('button', { name: /전체 보기/ }))
    expect(screen.getByRole('list', { name: '이번 주 순위' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('list', { name: '이번 주 순위' })).not.toBeInTheDocument(),
    )
  })

  it('기록이 없으면 펼치기 버튼을 두지 않는다', async () => {
    respondWith([])
    render(<RankingTicker layout="wide" />)

    expect(await screen.findByText(/로그인하고 1위 도전하기/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /전체 보기/ })).not.toBeInTheDocument()
  })
})

describe('RankingTicker · 내 순위', () => {
  it('목록에 내가 없으면 내 줄을 따로 잇는다', async () => {
    respondWith(fiveEntries)
    myRankIs(27)
    signIn('me')
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    await user.click(await screen.findByRole('button', { name: /전체 보기/ }))

    const mine = screen.getByRole('list', { name: '내 순위' })
    expect(mine).toHaveTextContent('27')
    expect(mine).toHaveTextContent('143점')
  })

  it('목록에 내가 있으면 줄을 잇지 않는다', async () => {
    respondWith(fiveEntries)
    myRankIs(2)
    signIn('u2')
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    await user.click(await screen.findByRole('button', { name: /전체 보기/ }))

    expect(screen.queryByRole('list', { name: '내 순위' })).not.toBeInTheDocument()
    expect(screen.getAllByText('이등')).toHaveLength(2)
  })

  it('이번 주 기록이 없으면 내 줄이 없다', async () => {
    respondWith(fiveEntries)
    myRankIs(null)
    signIn('me')
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    await user.click(await screen.findByRole('button', { name: /전체 보기/ }))

    expect(screen.queryByRole('list', { name: '내 순위' })).not.toBeInTheDocument()
  })

  it('로그인하지 않으면 내 줄이 없다', async () => {
    respondWith(fiveEntries)
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    await user.click(await screen.findByRole('button', { name: /전체 보기/ }))

    expect(screen.queryByRole('list', { name: '내 순위' })).not.toBeInTheDocument()
  })
})

describe('RankingTicker · 갱신', () => {
  it('기록이 없는 주에는 로그인을 권한다', async () => {
    respondWith([])
    render(<RankingTicker layout="narrow" />)

    expect(await screen.findByText(/로그인하고 1위 도전하기/)).toBeInTheDocument()
  })

  it('읽지 못하면 띠 자체를 그리지 않는다', async () => {
    mockApiServer.use(
      http.get('/api/v1/rankings/weekly', () =>
        HttpResponse.json({ code: 'BOOM' }, { status: 503 }),
      ),
    )
    render(<RankingTicker layout="wide" />)

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '이번 주 요트랭킹' })).not.toBeInTheDocument(),
    )
  })
})
