import type { WsPlayer, WsRoomPhase, WsRoomSnapshot } from './protocol.js'
import { type RoomMember, RoomMembers, toWsPlayer } from './roomMembers.js'
import type { ClientSocket } from './socket.js'

// 좌석 타입은 roomMembers.ts가 정본이지만 기존 소비자(chat·roomJoin 등)가 이 파일에서
// 가져가므로 여기서 re-export한다.
export type { RoomMember } from './roomMembers.js'
export { toWsPlayer } from './roomMembers.js'

/**
 * 방 멤버십(누가·어느 방에·어떤 정체성/상태로)의 인메모리 저장소.
 *
 * 역할 분담: "봉투를 방 전원에게 쏘는 팬아웃"은 `RoomBroadcaster`, "그 방에 지금
 * 누가 있는지"는 여기다. 둘 다 인메모리이고 **상태의 권위는 Redis**에 있다
 * (docs/design/realtime.md 「구독·브로드캐스트 모델」).
 *
 * 좌석 명단 자체는 `roomMembers.ts`의 `RoomMembers`가 맡는다 — 이 클래스는
 * phase·gameCode·메트릭 집계처럼 **방 단위 부가 정보**를 얹고, 방이 비면 그 정보를
 * 함께 버린다(방 코드는 재사용되기 때문이다).
 */
export class RoomSessionRegistry {
  private readonly members = new RoomMembers()
  private readonly phases = new Map<string, WsRoomPhase>()
  private readonly gameCodes = new Map<string, string>()

  /** 방에 적힌 게임을 기록한다. 같은 방에 다른 게임이 들어오면 상태가 섞이므로 던진다. */
  registerGame(roomId: string, gameCode: string | null | undefined): void {
    if (!gameCode || gameCode.trim().length === 0) throw new Error('invalid_game_code')
    const current = this.gameCodes.get(roomId)
    if (current !== undefined && current !== gameCode) throw new Error('room_game_mismatch')
    this.gameCodes.set(roomId, gameCode)
  }

  /**
   * 방 입장. 그 방의 첫 입장자가 host가 되고, **같은 playerId의 재입장은 자리와
   * host를 유지한 채 소켓만 교체**한다(재접속 경로).
   */
  join(roomId: string, socket: ClientSocket, playerId: string, nickname: string): RoomMember {
    return this.members.join(roomId, socket, playerId, nickname)
  }

  /** 방 안에서 이 playerId가 차지한 자리. 재접속·중복 세션 판정에 쓴다. */
  find(roomId: string, playerId: string): RoomMember | null {
    return this.members.find(roomId, playerId)
  }

  /**
   * 그 방의 좌석 전부(오프라인 좌석·파티 대시보드 포함).
   *
   * 방송이 아니라 **좌석마다 다른 내용을 보내야 하는** 게임이 쓴다(다빈치 코드의
   * `DavinciAudience`). 방 스냅샷의 플레이어 명단으로는 대신할 수 없다 — 대시보드는
   * 명단에 없지만 화면을 받아야 하기 때문이다.
   */
  membersOf(roomId: string): RoomMember[] {
    return this.members.ofRoom(roomId)
  }

  of(socket: ClientSocket): RoomMember | null {
    return this.members.ofSocket(socket)
  }

  /** 대기실에서의 소켓 종료·명시 퇴장. @returns 빠진 멤버(원래 없었으면 null). */
  remove(socket: ClientSocket): RoomMember | null {
    const member = this.members.removeBySocket(socket)
    if (member !== null && this.members.isEmpty(member.roomId)) this.forgetRoom(member.roomId)
    return member
  }

  /**
   * 게임 중 비명시 종료를 명단 이탈이 아닌 offline 전이로 기록한다.
   * 이미 새 소켓으로 교체된 뒤 옛 소켓의 close가 도착하면 현재 멤버를 건드리지 않는다.
   */
  markOffline(socket: ClientSocket): RoomMember | null {
    return this.members.markOffline(socket)
  }

  /**
   * playerId로 좌석을 뺀다. 오프라인 멤버는 소켓이 없어 {@link remove}로 지울 수
   * 없으므로 게임 중 이탈(명시 퇴장·오프라인 자동 퇴장)은 이 경로를 쓴다.
   */
  removePlayer(roomId: string, playerId: string): RoomMember | null {
    const member = this.members.removePlayer(roomId, playerId)
    if (member !== null && this.members.isEmpty(roomId)) this.forgetRoom(roomId)
    return member
  }

  /** 게임 시작처럼 **REST가 상태를 바꾸는** 경로에서 알려 준다. 기본은 `waiting`. */
  markPhase(roomId: string, phase: WsRoomPhase): void {
    this.phases.set(roomId, phase)
  }

  phaseOf(roomId: string): WsRoomPhase {
    return this.phases.get(roomId) ?? 'waiting'
  }

  gameCodeOf(roomId: string): string | null {
    return this.gameCodes.get(roomId) ?? null
  }

  /** 현재 게임을 진행 중인 방의 수(`yorr_rooms_active`). */
  activeRoomCount(): number {
    let count = 0
    for (const phase of this.phases.values()) if (phase === 'playing') count += 1
    return count
  }

  /** 그 게임을 플레이 중이며 소켓이 살아 있는 참가자 수(`yorr_game_participants_active`). */
  activeParticipantCount(gameCode: string | null | undefined): number {
    if (!gameCode || gameCode.trim().length === 0) return 0
    const wanted = gameCode.toUpperCase()
    const players = new Set<string>()
    for (const member of this.members.bySocket.values()) {
      if (this.phaseOf(member.roomId) !== 'playing') continue
      if (this.gameCodeOf(member.roomId)?.toUpperCase() !== wanted) continue
      players.add(member.playerId)
    }
    return players.size
  }

  /**
   * 인메모리 명단만으로 만드는 스냅샷. 게임 진행 상태(`game`)와 Redis 참가자(봇 포함)는
   * 모르므로 실시간 병합은 `RealtimeRoomSnapshotService`가 한다.
   */
  snapshot(roomId: string): WsRoomSnapshot {
    const players: WsPlayer[] = []
    let hostId: string | undefined
    for (const member of this.members.ofRoom(roomId)) {
      players.push(toWsPlayer(member))
      if (member.host) hostId = member.playerId
    }
    return {
      roomId,
      gameCode: this.gameCodes.get(roomId),
      phase: this.phaseOf(roomId),
      hostId,
      players,
    }
  }

  /** 방이 비면 phase·gameCode도 함께 버린다 — 방 코드는 재사용되기 때문이다. */
  private forgetRoom(roomId: string): void {
    this.gameCodes.delete(roomId)
    this.phases.delete(roomId)
  }
}
