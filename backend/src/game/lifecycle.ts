import type { GameStartResult, RoomService } from '../room/roomService.js'
import type { RoomSnapshot } from '../room/snapshot.js'
import type { GameCatalog } from './catalog.js'

/**
 * 방 phase 전이와 게임 모듈 초기화를 잇는 자리 — backend-java `GameLifecycleService`.
 *
 * **Phase 1에서는 모듈이 아직 없다.** 지금은 카탈로그에서 시작 인원만 읽어
 * 방 상태를 옮기고, 모듈 훅(`start`/`reset`/`removePlayer`)은 Phase 2.1에서
 * 이 세 메서드 안에 채운다 — 호출부(REST 라우트)는 그때 바뀌지 않는다.
 */
export class GameLifecycleService {
  constructor(
    private readonly rooms: RoomService,
    private readonly catalog: GameCatalog,
  ) {}

  async start(roomCode: string): Promise<GameStartResult> {
    const room = await this.rooms.getSnapshot(roomCode)
    const game = this.catalog.require(room.gameCode)
    // 2.1: 여기서 module.start(roomCode, game) → 실패 시 rooms.rollbackStart(roomCode, gameId)
    return this.rooms.startGame(roomCode, Math.max(1, game.minPlayers))
  }

  /** @returns 실제로 대기실로 되돌렸는지. 저장소 전이가 권위다 — 막히면 아무것도 건드리지 않는다. */
  async returnToLobby(roomCode: string, room: RoomSnapshot): Promise<boolean> {
    if (!(await this.rooms.returnToLobby(roomCode))) return false
    // 모르는 게임 코드면 여기서 던진다(Java의 modules.require(...).reset(roomCode)와 같은 지점).
    this.catalog.require(room.gameCode)
    // 2.1: module.reset(roomCode)
    return true
  }

  /**
   * 게임 중 명시적 퇴장. 뒤따르는 소켓 close는 "끊김"과 구분되지 않으므로 WS 명단·턴
   * 순서를 여기서 정리해야 한다 — 모듈이 붙는 2.1까지는 할 일이 없다.
   */
  async removePlayer(_roomCode: string, gameCode: string | null, _playerId: string): Promise<void> {
    this.catalog.require(gameCode)
    // 2.1: module.removePlayer(roomCode, playerId)
  }
}
