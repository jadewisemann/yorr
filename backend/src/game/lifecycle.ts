import type { GameStartResult, RoomService } from '../room/roomService.js'
import type { RoomSnapshot } from '../room/snapshot.js'
import type { GameCatalog } from './catalog.js'
import { GameModuleRegistry } from './module.js'

/**
 * 방 phase 전이와 게임 모듈 초기화를 잇는 자리.
 *
 * 게임 코드 검증(`invalid_game_code`)과 시작 인원은 카탈로그가, 실제 상태
 * 초기화·정리는 모듈이 맡는다. **모듈이 아직 없는 게임도 정상 경로다** —
 * 그 방은 phase만 옮겨지고 게임 상태가 없는 채로 돌아간다(3.x가 하나씩 채운다).
 *
 * pause/resume/close는 이 서비스를 거치지 않는다 — WS 계층이 모듈을 직접 부른다.
 */
export class GameLifecycleService {
  constructor(
    private readonly rooms: RoomService,
    private readonly catalog: GameCatalog,
    /**
     * 기본값은 **빈** 레지스트리다(= 모듈 없음, 1.4까지의 동작 그대로). 부팅 배선이
     * WS 게이트웨이와 **같은 인스턴스**를 넘겨야 REST로 시작한 게임의 모듈 훅이
     * 실제로 돈다 — 새로 만들면 등록된 모듈이 하나도 없는 레지스트리가 된다.
     */
    private readonly modules: GameModuleRegistry = new GameModuleRegistry(catalog),
  ) {}

  /**
   * `POST /rooms/{code}/games`. 순서가 계약이다: 스냅샷 → 게임 결정 → **START Lua**
   * (phase/gameId 전이 + minPlayers 검증) → `module.start`.
   *
   * 모듈이 던지면 **ROLLBACK_START(gameId)** 후 그대로 재throw한다. gameId를 함께
   * 넘기므로 그 사이 시작된 다른 게임은 되돌리지 않는다(자기 게임만).
   */
  async start(roomCode: string): Promise<GameStartResult> {
    const room = await this.rooms.getSnapshot(roomCode)
    const meta = this.catalog.require(room.gameCode)
    const module = this.modules.byCode(room.gameCode)
    const game = await this.rooms.startGame(roomCode, Math.max(1, meta.minPlayers))
    if (!module) return game
    try {
      await module.start(roomCode, game)
      return game
    } catch (error) {
      // 롤백 실패는 감추지 않는다 — 그 예외가 원인 예외를 대신 올라간다.
      await this.rooms.rollbackStart(roomCode, game.gameId)
      throw error
    }
  }

  /** @returns 실제로 대기실로 되돌렸는지. 저장소 전이가 권위다 — 막히면 아무것도 건드리지 않는다. */
  async returnToLobby(roomCode: string, room: RoomSnapshot): Promise<boolean> {
    if (!(await this.rooms.returnToLobby(roomCode))) return false
    // 모르는 게임 코드면 여기서 던진다.
    this.catalog.require(room.gameCode)
    await this.modules.byCode(room.gameCode)?.reset(roomCode)
    return true
  }

  /**
   * 게임 중 명시적 퇴장. 뒤따르는 소켓 close는 "끊김"과 구분되지 않으므로 WS 명단·턴
   * 순서를 여기서 정리해야 한다 — 그 정리는 모듈의 `removePlayer`가 한다.
   */
  async removePlayer(roomCode: string, gameCode: string | null, playerId: string): Promise<void> {
    this.catalog.require(gameCode)
    await this.modules.byCode(gameCode)?.removePlayer(roomCode, playerId)
  }
}
