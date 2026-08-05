import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import type { ServerMessage } from '@/realtime/wsEvents'
import type { RoomSession } from '@/room/api/roomApi'
import { renderAppHarness } from '@/test/harness'
import { createDiceSet } from '@/yacht/domain/dice'
import { scoreCategory, YACHT_CATEGORIES, type YachtCategory } from '@/yacht/domain/scoring'
import {
  keepBounds,
  rotateSeats,
  TEAM_YACHT_ROUNDS,
  type TeamYachtRecord,
  type TeamYachtStage,
  type TeamYachtView,
} from '@/yacht/domain/teamProject'
import { categoryLabel } from '@/yacht/yachtCategoryView'

/**
 * 조별과제 야트 진행 화면 통합 테스트(S15P11A406-209).
 *
 * 아래 {@link createTeamYachtServer}는 <b>서버 대역</b>이다 — 실제 판정은 백엔드
 * {@code TeamYachtRules}가 하고(그쪽은 별도 단위 테스트가 있다), 여기서는 그 계약대로 오는
 * 상태를 화면이 제대로 이어받는지를 본다: 순차 킵 · 가려진 주사위 · 다수결 · 룰렛 · 12라운드.
 */

const YOU = 'me'
const MATE_ONE = 'mate-1'
const MATE_TWO = 'mate-2'
const ROOM_ID = 'TEAM01'

afterEach(() => {
  vi.useRealTimers()
})

describe('조별과제 야트', () => {
  it('세 사람이 한 번씩 굴리는 라운드를 12번 돌아 끝난다', async () => {
    const server = createTeamYachtServer()
    const { user } = await renderTeamProject(server)

    for (let round = 1; round <= TEAM_YACHT_ROUNDS; round++) {
      expect(await screen.findByText(`조별과제 · 라운드 ${round}/12`)).toBeInTheDocument()
      await playRound(user, server)
    }

    expect(await screen.findByText('조별과제 · 12라운드 종료')).toBeInTheDocument()
    expect(screen.getByText(String(server.total()))).toBeInTheDocument()
  })

  it('앞 주자가 버린 주사위는 눈이 보이지 않는다', async () => {
    const server = createTeamYachtServer()
    const { user } = await renderTeamProject(server)

    await user.click(await screen.findByRole('button', { name: '굴리기' }))
    // 굴린 사람은 다섯 개를 다 본다.
    expect(screen.queryAllByLabelText('가려진 주사위')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '주사위 1' }))
    await user.click(screen.getByRole('button', { name: /^킵 확정/ }))

    // 넘긴 뒤에는 내가 킵한 한 개만 남고 나머지는 가려진다.
    expect(await screen.findByText(/앞 주자가 킵한 눈만/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('가려진 주사위')).toHaveLength(4)
  })

  it('아무것도 킵하지 않고 넘길 수 없고, 뒤 주자 몫보다 많이 킵할 수도 없다', async () => {
    const server = createTeamYachtServer()
    const { user } = await renderTeamProject(server)

    await user.click(await screen.findByRole('button', { name: '굴리기' }))
    expect(screen.getByRole('button', { name: '킵 확정 (0/3)' })).toBeDisabled()

    for (const slot of [1, 2, 3, 4]) {
      await user.click(screen.getByRole('button', { name: `주사위 ${slot}` }))
    }
    // 네 번째를 골라도 상한(3)을 넘지 않는다 — 뒤 두 주자가 굴릴 주사위가 남아야 한다.
    expect(screen.getByRole('button', { name: '킵 확정 (3/3)' })).toBeEnabled()
  })

  it('동표면 룰렛이 돌다가 서버가 정한 족보에서 멈춘다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const server = createTeamYachtServer({ tieBreak: true })
    const { user } = await renderTeamProject(server)

    await playRound(user, server)

    expect(await screen.findByText('투표 1:1:1 — 룰렛')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(3_000)
    const recorded = server.lastRecord()
    expect(
      await screen.findByText(`${categoryLabel[recorded.category]} · ${recorded.score}점 기록`),
    ).toBeInTheDocument()
  })
})

/** 한 라운드를 끝까지 진행한다 — 내 굴림·킵, 팀원 둘의 자동 진행, 그리고 내 투표까지. */
async function playRound(
  user: ReturnType<typeof renderAppHarness>['user'],
  server: TeamYachtServer,
) {
  while (server.stage() !== 'VOTE') {
    if (server.runnerId() !== YOU) {
      server.autoPlay()
      continue
    }
    await user.click(await screen.findByRole('button', { name: '굴리기' }))
    if (server.stage() !== 'KEEP') continue
    await user.click(screen.getByRole('button', { name: `주사위 ${server.firstUnkept() + 1}` }))
    await user.click(screen.getByRole('button', { name: /^킵 확정/ }))
  }

  const category = server.nextOpenCategory()
  await user.click(await screen.findByRole('button', { name: voteRowName(category, server) }))
}

function voteRowName(category: YachtCategory, server: TeamYachtServer) {
  return `${categoryLabel[category]} ${scoreCategory(server.dice(), category)}`
}

async function renderTeamProject(server: TeamYachtServer) {
  const realtimeClient = new FakeRealtimeClient({
    handlers: {
      'game.team_yacht.roll': () => [server.roll()],
      'game.team_yacht.keep': (message) => [server.keep(message.payload.keep)],
      'game.team_yacht.vote': (message) => [server.vote(message.payload.category)],
    },
  })
  server.attach(realtimeClient)

  const harness = renderAppHarness({
    initialPath: '/team-yacht',
    realtimeClient,
    session: teamSession(),
  })
  // 화면은 지연 로드다 — 대기실이 그려진 뒤에야 개인 상태를 받을 상대가 붙어 있다.
  await screen.findByText('조별과제 야트 · 대기실')
  realtimeClient.emitMessage(server.state())
  return harness
}

function teamSession(): RoomSession {
  return {
    gameId: 'game-1',
    membershipRole: 'host',
    nickname: '나',
    roomCode: ROOM_ID,
    roomId: ROOM_ID,
    sessionToken: 'token',
    you: YOU,
    snapshot: {
      phase: 'playing',
      players: [
        { nickname: '나', playerId: YOU, status: 'online' },
        { nickname: '팀원1', playerId: MATE_ONE, status: 'online' },
        { nickname: '팀원2', playerId: MATE_TWO, status: 'online' },
      ],
      hostId: YOU,
      roomId: ROOM_ID,
    },
  }
}

interface TeamYachtServer {
  attach(client: FakeRealtimeClient): void
  autoPlay(): void
  dice(): ReturnType<typeof createDiceSet>
  firstUnkept(): number
  keep(picks: number[]): ServerMessage
  lastRecord(): TeamYachtRecord
  nextOpenCategory(): YachtCategory
  roll(): ServerMessage
  runnerId(): string
  stage(): TeamYachtStage
  state(): ServerMessage
  total(): number
  vote(category: YachtCategory): ServerMessage
}

/**
 * 서버 대역. 규칙의 권위는 백엔드지만, 화면을 굴려 보려면 계약대로 상태를 돌려주는 상대가
 * 필요하다. 주사위는 테스트가 읽을 수 있게 고정 순환값을 쓴다(눈의 무작위성은 이 테스트의 관심이 아니다).
 */
function createTeamYachtServer({ tieBreak = false } = {}): TeamYachtServer {
  let seats = [YOU, MATE_ONE, MATE_TWO]
  let round = 1
  let leg = 0
  let stage: TeamYachtStage = 'ROLL'
  let faces = [1, 2, 3, 4, 5]
  let kept = [false, false, false, false, false]
  let votes: Record<string, YachtCategory> = {}
  let recorded: Record<string, number> = {}
  let last: TeamYachtRecord | null = null
  let spin = 0
  let client: FakeRealtimeClient | null = null

  const runnerId = () => seats[leg] as string
  const firstUnkept = () => kept.findIndex((locked) => !locked)
  const openCategories = () => YACHT_CATEGORIES.filter((category) => !(category in recorded))
  const total = () =>
    Object.values(recorded).reduce((sum, score) => sum + score, 0) + upperBonus(recorded)

  const view = (): TeamYachtView => ({
    stage,
    round,
    rounds: TEAM_YACHT_ROUNDS,
    seats: [...seats],
    leg,
    runnerId: stage === 'ROLL' || stage === 'KEEP' ? runnerId() : null,
    // 백엔드 TeamYachtView와 같은 가리기 규칙: 잠긴 눈은 모두에게, 나머지는 굴린 주자에게만.
    dice: faces.map((face, index) => (kept[index] || runnerId() === YOU ? (face as number) : null)),
    kept: [...kept],
    ...keepMarks(),
    votes: { ...votes },
    board: board(recorded),
    last,
  })

  const keepMarks = () => {
    if (stage !== 'KEEP') return { minKeep: 0, maxKeep: 0 }
    const bounds = keepBounds(leg, kept)
    return { minKeep: bounds.min, maxKeep: bounds.max }
  }

  const message = (): ServerMessage => ({
    type: 'game.team_yacht.state',
    ts: Date.now(),
    payload: view(),
    roomId: ROOM_ID,
  })

  const rollDice = () => {
    spin += 1
    faces = faces.map((face, index) => (kept[index] ? face : ((face + spin) % 6) + 1))
    stage = leg === 2 ? 'VOTE' : 'KEEP'
    if (leg === 2) kept = [true, true, true, true, true]
  }

  const applyKeep = (picks: number[]) => {
    for (const pick of picks) kept[pick] = true
    leg += 1
    stage = 'ROLL'
  }

  const resolve = () => {
    const candidates = seats.map((seat) => votes[seat] as YachtCategory)
    const winner = tieBreak ? (candidates[1] as YachtCategory) : (candidates[0] as YachtCategory)
    const score = scoreCategory(createDiceSet(faces), winner)
    recorded = { ...recorded, [winner]: score }
    last = {
      round,
      category: winner,
      score,
      ...(tieBreak ? { rouletteCandidates: candidates, rouletteSeed: 1 } : {}),
    }

    if (round >= TEAM_YACHT_ROUNDS) {
      stage = 'FINISHED'
      return
    }
    round += 1
    seats = rotateSeats(seats)
    leg = 0
    stage = 'ROLL'
    kept = [false, false, false, false, false]
    votes = {}
  }

  return {
    attach: (attached) => {
      client = attached
    },
    autoPlay: () => {
      rollDice()
      if (stage === 'KEEP') applyKeep([firstUnkept()])
      client?.emitMessage(message())
    },
    dice: () => createDiceSet(faces),
    firstUnkept,
    keep: (picks) => {
      applyKeep(picks)
      return message()
    },
    lastRecord: () => last as TeamYachtRecord,
    nextOpenCategory: () => openCategories()[0] as YachtCategory,
    roll: () => {
      rollDice()
      return message()
    },
    runnerId,
    stage: () => stage,
    state: message,
    total,
    vote: (category) => {
      // 내 표가 들어오면 팀원 둘의 표도 같이 들어온 것으로 본다 — 화면은 세 표가 모인 결과만 본다.
      const others = tieBreak
        ? openCategories()
            .filter((open) => open !== category)
            .slice(0, 2)
        : [category, openCategories().find((open) => open !== category) as YachtCategory]
      votes = {
        [YOU]: category,
        [MATE_ONE]: others[0] as YachtCategory,
        [MATE_TWO]: others[1] as YachtCategory,
      }
      resolve()
      return message()
    },
  }
}

function board(recorded: Record<string, number>): TeamYachtView['board'] {
  const categories = Object.fromEntries(
    YACHT_CATEGORIES.map((category) => [category, recorded[category] ?? null]),
  ) as TeamYachtView['board']['categories']
  const upperSubtotal = upperSum(recorded)
  const bonus = upperBonus(recorded)
  return {
    categories,
    upperSubtotal,
    upperBonus: bonus,
    total: Object.values(recorded).reduce((sum, score) => sum + score, 0) + bonus,
  }
}

function upperSum(recorded: Record<string, number>) {
  return (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const).reduce(
    (sum, category) => sum + (recorded[category] ?? 0),
    0,
  )
}

function upperBonus(recorded: Record<string, number>) {
  return upperSum(recorded) >= 63 ? 35 : 0
}
