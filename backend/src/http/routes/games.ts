import type { FastifyInstance } from 'fastify'
import type { RoomService } from '../../room/roomService.js'

export interface GameRouteDependencies {
  readonly rooms: RoomService
}

export const registerGameRoutes = async (
  app: FastifyInstance,
  deps: GameRouteDependencies,
): Promise<void> => {
  /**
   * 현재 게임 상태 조회. **인증이 없고**, 없는 게임도 404가 아니라 전 필드 null
   * 스냅샷으로 200이다(계약 — docs/design/rooms-and-sessions.md).
   */
  app.get<{ Params: { gameId: string } }>('/games/:gameId', async (request) =>
    deps.rooms.getGameSnapshot(request.params.gameId),
  )
}
