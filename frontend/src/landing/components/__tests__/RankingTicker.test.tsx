import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { useAppStore } from '@/store'
import { RankingTicker } from '../RankingTicker'

type Entry = { rank: number; userId: string; nickname: string; bestScore: number }

/** 주기 갱신은 이 파일이 보지 않는다 — 훅의 책임이라 useRankingApi.test.ts가 맡는다. */
function respondWith(entries: Entry[]) {
  mockApiServer.use(
    http.get('/api/v1/rankings/weekly', () =>
      HttpResponse.json({ weekStart: '2026-08-03', entries }),
    ),
  )
}

/** 로그인 상태를 만든다. 내 순위는 회원에게만 있는 개념이라 세션 없이는 조회 자체가 없다. */
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

// reset()은 방 상태만 비우고 로그인은 일부러 남긴다 — 로그아웃해야 세션이 지워진다.
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

/** 띠는 5명까지라, 띠와 드롭다운이 갈리는 것을 보려면 그보다 긴 목록이 필요하다. */
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

  /**
   * 흐르게 하려면 같은 목록을 두 벌 그려야 하는데, 두 번째 벌은 눈속임이다. 보조기기에
   * 노출되면 순위를 두 번 읽으므로 role 질의에는 한 벌만 잡혀야 한다.
   */
  it('흐를 때 복제한 목록은 보조기기에서 감춘다', async () => {
    respondWith(fiveEntries)
    render(<RankingTicker layout="narrow" />)

    // 눈에는 여러 벌이 보이지만 접근성 트리에는 한 벌(5개)만 있다.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
    expect(screen.getAllByText('일등').length).toBeGreaterThan(1)
  })

  /**
   * 되돌아가는 순간 튀지 않으려면 <b>이동 거리가 정확히 한 벌 폭</b>이어야 한다. 한 벌은 트랙
   * 폭의 1/복제수이므로 이동 거리 × 복제수 = 100%가 성립해야 한다. 예전에 -50%를 박아둔 채
   * 복제 수가 둘이 아니게 되면서 실제로 눈에 보이게 튀었다.
   */
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

  /** 한 명뿐인데 흘리면 같은 이름만 끝없이 되돌아와 고장난 것처럼 보인다 — 세워 둔다. */
  it('한 명뿐이면 복제하지 않는다', async () => {
    respondWith([first])
    render(<RankingTicker layout="narrow" />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getAllByText('일등')).toHaveLength(1)
  })

  /** 둘부터는 순위가 바뀌며 지나가므로 흐르는 값을 한다 — 경계가 흔들리면 한 명일 때 되돌아온다. */
  it('두 명이면 흐른다', async () => {
    respondWith(twoEntries)
    render(<RankingTicker layout="narrow" />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(screen.getAllByText('일등').length).toBeGreaterThan(1)
  })
})

describe('RankingTicker · wide', () => {
  /** 데스크톱에서 움직이는 글자를 눈으로 따라가는 것은 읽는 게 아니라 기다리는 일이다. */
  it('흐르지 않고 상위 몇 명만 세워 둔다', async () => {
    respondWith(sevenEntries)
    render(<RankingTicker layout="wide" />)

    // 띠는 5명까지다. 6·7등은 드롭다운을 펼쳐야 보인다.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
    // 복제한 두 번째 벌이 없다 — 흐르지 않으므로 이어붙일 이유도 없다.
    expect(screen.getAllByText('일등')).toHaveLength(1)
    expect(screen.queryByText('육등')).not.toBeInTheDocument()
  })

  /** 세워 둔 띠는 잘린 곳에서 끝난 것처럼 보인다 — 몇 명이 더 있는지 글자로 말해야 한다. */
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

  /** 기록이 없으면 펼칠 것도 없다 — 빈 패널을 열 수 있는 버튼을 두지 않는다. */
  it('기록이 없으면 펼치기 버튼을 두지 않는다', async () => {
    respondWith([])
    render(<RankingTicker layout="wide" />)

    expect(await screen.findByText(/첫 순위의 주인이 되어보세요/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /전체 보기/ })).not.toBeInTheDocument()
  })
})

describe('RankingTicker · 내 순위', () => {
  /**
   * 상위 목록만 보여주면 그 밖의 회원에게 랭킹은 남의 이야기가 된다. 자기 자리를 알 수 있어야
   * 다음 판을 할 이유가 생긴다.
   */
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

  /** 이미 목록에 있으면 같은 사람이 두 번 보인다 — 강조만 하고 줄은 잇지 않는다. */
  it('목록에 내가 있으면 줄을 잇지 않는다', async () => {
    respondWith(fiveEntries)
    myRankIs(2)
    signIn('u2')
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    await user.click(await screen.findByRole('button', { name: /전체 보기/ }))

    expect(screen.queryByRole('list', { name: '내 순위' })).not.toBeInTheDocument()
    expect(screen.getAllByText('이등')).toHaveLength(2) // 띠 + 드롭다운
  })

  /** 이번 주 한 판도 안 했으면 순위가 없다(서버 204). 없는 자리를 만들어 보여주지 않는다. */
  it('이번 주 기록이 없으면 내 줄이 없다', async () => {
    respondWith(fiveEntries)
    myRankIs(null)
    signIn('me')
    const user = userEvent.setup()
    render(<RankingTicker layout="wide" />)

    await user.click(await screen.findByRole('button', { name: /전체 보기/ }))

    expect(screen.queryByRole('list', { name: '내 순위' })).not.toBeInTheDocument()
  })

  /** 로그인하지 않았으면 "내 순위"라는 개념 자체가 없다. */
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

    expect(await screen.findByText(/첫 순위의 주인이 되어보세요/)).toBeInTheDocument()
  })

  /** 랭킹은 부가 정보다. 못 읽었다는 사실을 랜딩 최상단에 얹어 알릴 일이 아니다. */
  it('읽지 못하면 띠 자체를 그리지 않는다', async () => {
    mockApiServer.use(
      http.get('/api/v1/rankings/weekly', () =>
        HttpResponse.json({ code: 'BOOM' }, { status: 503 }),
      ),
    )
    render(<RankingTicker layout="wide" />)

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '이번 주 파워랭킹' })).not.toBeInTheDocument(),
    )
  })
})
