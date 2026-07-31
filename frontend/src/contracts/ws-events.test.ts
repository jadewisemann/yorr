import { describe, expect, it, vi } from 'vitest'
import {
  buildClientMessage,
  isServer,
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  WS_PROTOCOL_VERSION,
  YACHT_CATEGORIES,
} from './ws-events'

describe('ws-events 계약 상수', () => {
  it('요트 정규룰 12족보를 순서까지 고정한다', () => {
    expect(YACHT_CATEGORIES).toEqual([
      'ones',
      'twos',
      'threes',
      'fours',
      'fives',
      'sixes',
      'choice',
      'fourOfAKind',
      'fullHouse',
      'smallStraight',
      'largeStraight',
      'yacht',
    ])
  })

  it('상단 보너스 규칙(63↑ → 35점)과 프로토콜 버전을 고정한다', () => {
    expect(UPPER_BONUS_THRESHOLD).toBe(63)
    expect(UPPER_BONUS_POINTS).toBe(35)
    expect(WS_PROTOCOL_VERSION).toBe(1)
  })
})

describe('isServer', () => {
  it('type이 일치할 때만 좁혀 준다', () => {
    const message = {
      type: 'sys.pong',
      ts: 1,
      payload: { serverTs: 1 },
    } as const

    expect(isServer(message, 'sys.pong')).toBe(true)
    expect(isServer(message, 'error')).toBe(false)
  })
})

describe('buildClientMessage', () => {
  it('ts를 채우고 payload를 그대로 싣는다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_753_000_000_000)

    expect(buildClientMessage('sys.ping', { clientTs: 7 })).toEqual({
      type: 'sys.ping',
      ts: 1_753_000_000_000,
      payload: { clientTs: 7 },
    })

    vi.restoreAllMocks()
  })

  it('roomId·msgId는 넘긴 값만 봉투에 붙인다', () => {
    const full = buildClientMessage(
      'room.ready',
      { ready: false },
      {
        roomId: 'YORR64',
        msgId: 'm-9',
      },
    )
    const bare = buildClientMessage('room.ready', { ready: false })

    expect(full).toMatchObject({ roomId: 'YORR64', msgId: 'm-9' })
    expect(bare).not.toHaveProperty('roomId')
    expect(bare).not.toHaveProperty('msgId')
  })
})
