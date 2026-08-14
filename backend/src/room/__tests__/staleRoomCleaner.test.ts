import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import type { UserIdentity } from '../../user/session.js'
import { RoomService } from '../roomService.js'
import { closeUnrecoverableGamesOnStartup } from '../staleRoomCleaner.js'

const HOST: UserIdentity = { userId: 'player-1', nickname: '호스트', type: 'GUEST' }

describeRedis('closeUnrecoverableGamesOnStartup', () => {
  const redis = useRedis()

  const openRoom = async (rooms: RoomService): Promise<string> => {
    const roomCode = await rooms.createRoom(6, HOST.userId, 'YACHT_DICE')
    await rooms.join(roomCode, HOST)
    return roomCode
  }

  /**
   * 이전 구현은 부팅 때 모든 방을 지워 배포마다 살아 있는 대기실까지 전멸시켰다.
   * 라운드 상태 없이도 정상 동작하는 방은 건드리지 않아야 한다.
   */
  it('대기실과 끝난 방은 그대로 둔다', async () => {
    const rooms = new RoomService(redis())
    const lobby = await openRoom(rooms)
    const finished = await openRoom(rooms)
    await rooms.startGame(finished, 1)
    await redis().hset(`room:${finished}`, 'phase', 'FINISHED')

    expect(await closeUnrecoverableGamesOnStartup(rooms)).toBe(0)

    expect((await rooms.getSnapshot(lobby)).phase).toBe('LOBBY')
    expect((await rooms.getSnapshot(finished)).phase).toBe('FINISHED')
  })

  /**
   * 마감 타이머는 인메모리라 재시작으로 사라진다. Redis만 PLAYING으로 남은 방은
   * 진행할 턴이 없는데 JOIN이 `game_started`로 참가까지 막는다.
   */
  it('이어갈 수 없는 진행 중 방을 닫는다', async () => {
    const rooms = new RoomService(redis())
    const playing = await openRoom(rooms)
    const lobby = await openRoom(rooms)
    await rooms.startGame(playing, 1)

    expect(await closeUnrecoverableGamesOnStartup(rooms)).toBe(1)

    expect((await rooms.getSnapshot(playing)).phase).toBeNull()
    expect((await rooms.getSnapshot(lobby)).phase).toBe('LOBBY')
  })

  it('이미 만료돼 phase를 못 읽는 방은 닫을 것도 없다', async () => {
    const rooms = new RoomService(redis())

    expect(await closeUnrecoverableGamesOnStartup(rooms)).toBe(0)
  })
})
