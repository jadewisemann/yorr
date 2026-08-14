import { beforeEach, describe, expect, it } from 'vitest'
import { RoomSessionRegistry } from '../registry.js'
import type { ClientSocket } from '../socket.js'

const socket = (): ClientSocket => ({ readyState: 1, send: () => {}, close: () => {} })

describe('RoomSessionRegistry', () => {
  let registry: RoomSessionRegistry

  beforeEach(() => {
    registry = new RoomSessionRegistry()
  })

  it('아직 표시되지 않은 방은 대기실이다', () => {
    registry.join('ROOM1', socket(), 'player-1', '호스트')

    expect(registry.snapshot('ROOM1').phase).toBe('waiting')
  })

  /** 게임 시작은 REST가 처리하므로 레지스트리는 markPhase로만 그 사실을 안다. */
  it('phase를 표시하면 스냅샷이 playing이 된다', () => {
    registry.join('ROOM1', socket(), 'player-1', '호스트')
    registry.join('ROOM1', socket(), 'player-2', '참가자')

    registry.markPhase('ROOM1', 'playing')

    expect(registry.snapshot('ROOM1').phase).toBe('playing')
    expect(registry.snapshot('ROOM1').players).toHaveLength(2)
  })

  it('phase는 방마다 따로다', () => {
    registry.join('ROOM1', socket(), 'player-1', '호스트')
    registry.join('ROOM2', socket(), 'player-2', '다른방 호스트')

    registry.markPhase('ROOM1', 'playing')

    expect(registry.snapshot('ROOM1').phase).toBe('playing')
    expect(registry.snapshot('ROOM2').phase).toBe('waiting')
  })

  /** 방 코드는 재사용된다 — playing이 남으면 새 방이 즉시 게임 중으로 보인다. */
  it('방이 비면 phase와 gameCode를 함께 버린다', () => {
    const only = socket()
    registry.registerGame('ROOM1', 'YACHT_DICE')
    registry.join('ROOM1', only, 'player-1', '호스트')
    registry.markPhase('ROOM1', 'playing')

    registry.remove(only)

    expect(registry.gameCodeOf('ROOM1')).toBeNull()
    registry.join('ROOM1', socket(), 'player-2', '새 호스트')
    expect(registry.snapshot('ROOM1').phase).toBe('waiting')
  })

  it('게임 중 끊김은 자리를 남긴 채 offline으로만 표시한다', () => {
    const player = socket()
    registry.join('ROOM1', player, 'player-1', '플레이어')
    registry.markPhase('ROOM1', 'playing')

    const offline = registry.markOffline(player)

    expect(offline?.status).toBe('offline')
    expect(registry.of(player)).toBeNull()
    expect(registry.snapshot('ROOM1').players).toEqual([
      {
        playerId: 'player-1',
        nickname: '플레이어',
        status: 'offline',
        isHost: true,
        kind: 'HUMAN',
      },
    ])
    expect(registry.phaseOf('ROOM1')).toBe('playing')
  })

  it('오프라인 좌석의 복귀는 host를 유지한 채 online이 된다', () => {
    const oldSocket = socket()
    registry.join('ROOM1', oldSocket, 'player-1', '플레이어')
    registry.markOffline(oldSocket)
    const newSocket = socket()

    const reconnected = registry.join('ROOM1', newSocket, 'player-1', '플레이어')

    expect(reconnected.status).toBe('online')
    expect(reconnected.host).toBe(true)
    expect(registry.of(newSocket)).toEqual(reconnected)
    expect(registry.snapshot('ROOM1').players).toHaveLength(1)
  })

  it('같은 사람의 소켓 교체는 host를 잃지 않는다', () => {
    const oldSocket = socket()
    const replacement = socket()

    registry.join('ROOM1', oldSocket, 'player-1', '호스트')
    const reconnected = registry.join('ROOM1', replacement, 'player-1', '호스트')

    expect(reconnected.host).toBe(true)
    expect(registry.of(oldSocket)).toBeNull()
    expect(registry.of(replacement)).toEqual(reconnected)
    expect(registry.snapshot('ROOM1').players).toHaveLength(1)
  })

  /** 오프라인 좌석은 소켓이 없어 remove로 지울 수 없다 — 게임 중 이탈의 경로다. */
  it('playerId로 오프라인 좌석을 뺄 수 있다', () => {
    const player = socket()
    registry.join('ROOM1', player, 'player-1', '플레이어')
    registry.join('ROOM1', socket(), 'player-2', '남는 사람')
    registry.markOffline(player)

    expect(registry.removePlayer('ROOM1', 'player-1')?.playerId).toBe('player-1')
    expect(registry.snapshot('ROOM1').players).toHaveLength(1)
    expect(registry.removePlayer('ROOM1', 'player-1')).toBeNull()
  })

  it('같은 방에 다른 게임이 들어오면 던진다', () => {
    registry.registerGame('ROOM1', 'YACHT_DICE')

    expect(() => registry.registerGame('ROOM1', 'YACHT_DICE')).not.toThrow()
    expect(() => registry.registerGame('ROOM1', 'DUEL')).toThrow('room_game_mismatch')
    expect(() => registry.registerGame('ROOM2', ' ')).toThrow('invalid_game_code')
  })

  it('메트릭은 playing인 방과 소켓이 살아 있는 참가자만 센다', () => {
    registry.registerGame('ROOM1', 'YACHT_DICE')
    registry.registerGame('ROOM2', 'YACHT_DICE')
    const offline = socket()
    registry.join('ROOM1', socket(), 'player-1', '한 명')
    registry.join('ROOM1', offline, 'player-2', '끊길 사람')
    registry.join('ROOM2', socket(), 'player-3', '대기실 사람')
    registry.markPhase('ROOM1', 'playing')

    expect(registry.activeRoomCount()).toBe(1)
    expect(registry.activeParticipantCount('yacht_dice')).toBe(2)

    registry.markOffline(offline)

    expect(registry.activeParticipantCount('YACHT_DICE')).toBe(1)
    expect(registry.activeParticipantCount('DUEL')).toBe(0)
    expect(registry.activeParticipantCount(null)).toBe(0)
  })
})
