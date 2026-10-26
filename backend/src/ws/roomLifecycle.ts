import type { RoomGameHooks } from '../game/module.js'
import type { RoomCloseScheduler } from '../room/closeScheduler.js'
import type { RoomService } from '../room/roomService.js'
import type { UserService } from '../user/session.js'
import type { RoomBroadcaster } from './broadcaster.js'
import type { ChatChannel } from './chat.js'
import { envelope } from './envelope.js'
import type { WsLogger } from './logger.js'
import type { RoomSessionRegistry } from './registry.js'
import type { ClientSocket } from './socket.js'

/**
 * 마지막 참가자의 소켓이 끊긴 뒤 **대기실**을 닫기까지의 유예.
 * 새로고침·터널 통과 같은 짧은 단절의 왕복이 끝날 만큼만 준다.
 */
export const EMPTY_LOBBY_GRACE_MS = 30_000

/**
 * **진행 중인 게임**이 비었을 때의 유예. 여기서 닫으면 점수판·라운드 진행처럼
 * 되돌릴 수 없는 값이 사라지고, 모바일의 앱 전환·화면 잠금·전화 수신은 30초를
 * 쉽게 넘긴다. 방 TTL(40분)이 상한이라 그보다 길게 잡을 이유는 없다.
 */
export const ACTIVE_GAME_GRACE_MS = 10 * 60 * 1000

export interface RoomLifecycleDeps {
  readonly registry: RoomSessionRegistry
  readonly broadcaster: RoomBroadcaster
  readonly users: UserService
  readonly rooms: RoomService
  readonly closeScheduler: RoomCloseScheduler
  readonly chat: ChatChannel
  readonly game: (roomId: string) => RoomGameHooks
  readonly log: WsLogger
  readonly broadcastPresence: (roomId: string, playerId: string, status: 'offline') => void
}

/**
 * 소켓 종료·명시 퇴장·빈 방 폐쇄 — **명단에서 빠지는 순서**를 한 곳에 모은 파일.
 *
 * 게이트웨이(`handler.ts`)에서 갈라 둔 이유: 이쪽은 "누가 나가면 무엇을 어떤 순서로
 * 정리하는가"만 알고, 메시지 라우팅은 게이트웨이가 한다. 순서가 계약인 부분(도배
 * 한도 정리가 명단 제거보다 먼저, 팬아웃 제거가 `player_left`보다 먼저)을 한 파일에
 * 모아 두면 바꿀 때 한 곳만 본다.
 */
export class RoomLifecycle {
  constructor(private readonly deps: RoomLifecycleDeps) {}

  /**
   * 소켓 종료. phase에 따라 "오프라인 전이"와 "명단 이탈"로 갈린다.
   */
  async closed(socket: ClientSocket): Promise<void> {
    // 도배 한도 기록 정리가 아래 분기보다 **먼저**다 — 레지스트리에서 소켓을 지우면
    // 소켓만으로는 누구였는지 알 수 없다(docs/design/chat.md).
    this.forgetChat(socket)
    const member = this.deps.registry.of(socket)
    if (!member) {
      this.deps.broadcaster.unregister(socket)
      return
    }
    if (this.deps.registry.phaseOf(member.roomId) === 'playing') {
      this.deps.broadcaster.unregister(socket)
      const offline = this.deps.registry.markOffline(socket)
      // 이미 새 소켓으로 교체된 뒤 도착한 옛 close는 아무것도 바꾸지 않는다.
      if (offline) this.deps.broadcastPresence(offline.roomId, offline.playerId, 'offline')
      return
    }
    await this.leaveRoom(socket)
  }

  /**
   * `room.leave` = 방 퇴장(소켓은 유지). 게임 중에는 턴 순서·Redis 명단까지 함께
   * 정리해야 하므로 게임 모듈의 이탈 경로로 보낸다. 프론트 프로덕션 코드는 REST
   * `DELETE /rooms/{code}/players/me`를 쓰고 이 메시지를 보내지 않는다.
   */
  async leave(socket: ClientSocket): Promise<void> {
    // 방을 떠나면 도배 한도 기록도 버린다. 아래 두 분기 모두 명단에서 이 소켓을 지우므로
    // 그 전에 처리해야 누구였는지 알 수 있다.
    this.forgetChat(socket)
    const member = this.deps.registry.of(socket)
    if (member && this.deps.registry.phaseOf(member.roomId) === 'playing') {
      this.deps.broadcaster.unregister(socket) // 본인을 팬아웃에서 뺀 뒤 player_left가 나간다
      await this.deps.game(member.roomId).removePlayer(member.roomId, member.playerId)
      await this.deps.users.clearRoom(member.playerId)
      return
    }
    await this.leaveRoom(socket)
  }

  /** 이 소켓의 사람이 누구였는지 아는 동안 도배 한도 기록을 버린다. */
  private forgetChat(socket: ClientSocket): void {
    const member = this.deps.registry.of(socket)
    if (member) this.deps.chat.forget(member.playerId)
  }

  /** 명시 퇴장·대기실 소켓 종료: 명단 제거 → 팬아웃 제거 → 남은 사람에게 player_left. */
  private async leaveRoom(socket: ClientSocket): Promise<void> {
    const member = this.deps.registry.of(socket)
    // 방이 비면 레지스트리가 gameCode를 버리므로 제거 **전에** 모듈을 잡아 둔다.
    const game = member ? this.deps.game(member.roomId) : null
    const gone = this.deps.registry.remove(socket)
    this.deps.broadcaster.unregister(socket) // 본인을 뺀 뒤 방송 → 본인은 안 받는다
    if (!gone || !game) return

    await this.deps.users.clearRoom(gone.playerId)
    this.deps.broadcaster.broadcast(
      gone.roomId,
      envelope('room.player_left', { playerId: gone.playerId }, { roomId: gone.roomId }),
    )
    if (this.deps.registry.snapshot(gone.roomId).players.length > 0) return

    // 마감 타이머는 즉시 끊는다 — 빈 방에서 자동 굴림·자동 기록이 계속 돌면 안 된다.
    await game.pause(gone.roomId)
    // 진행 상태는 아직 버리지 않는다. 새로고침은 "끊고 다시 연결"이라 여기서
    // 버리면 돌아온 사람이 자기 게임을 잃는다.
    const grace = (await game.hasState(gone.roomId)) ? ACTIVE_GAME_GRACE_MS : EMPTY_LOBBY_GRACE_MS
    this.deps.closeScheduler.schedule(gone.roomId, grace, () =>
      this.closeRoomIfStillEmpty(gone.roomId, game),
    )
  }

  /**
   * 유예가 끝났다. 예약 시점과 실행 시점 사이에 누군가 돌아올 수 있어 여기서 한 번
   * 더 확인한다 — 예약 취소와 이 검사는 의도적인 이중 방어다.
   */
  private async closeRoomIfStillEmpty(roomId: string, game: RoomGameHooks): Promise<void> {
    if (this.deps.registry.snapshot(roomId).players.length > 0) return
    await game.close(roomId)
    await this.deps.rooms.close(roomId)
    this.deps.log.info({ roomId }, '빈 방을 닫았습니다')
  }
}
