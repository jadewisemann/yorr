import type { PlayerStatus, WsPlayer } from './protocol.js'
import type { ClientSocket } from './socket.js'

/**
 * 방 멤버십의 **자료형과 좌석 조작** — 명단 등록·조회·이탈·오프라인 전이.
 *
 * `RoomSessionRegistry`(registry.ts)에서 갈라 둔 이유: 이쪽은 "누가 어느 방에
 * 있는가"만 알고, phase·gameCode·활성 수 집계는 그 반대편 관심사다. 두 관심사를
 * 한 파일에 두면 할스테드 난이도가 상한을 넘고, 무엇보다 명단 조작을 읽는 사람이
 * 메트릭 집계를 지나쳐야 한다.
 *
 * 둘 다 인메모리이고 **상태의 권위는 Redis**에 있다
 * (docs/design/realtime.md 「구독·브로드캐스트 모델」).
 */
export interface RoomMember {
  readonly playerId: string
  readonly roomId: string
  readonly nickname: string
  readonly host: boolean
  readonly status: PlayerStatus
  /** 오프라인 좌석은 소켓이 없다 — 자리는 남기고 연결만 없는 상태. */
  readonly socket: ClientSocket | null
}

export const toWsPlayer = (member: RoomMember): WsPlayer => ({
  playerId: member.playerId,
  nickname: member.nickname,
  status: member.status,
  isHost: member.host,
  kind: 'HUMAN',
})

/**
 * 방별 좌석 명단과 소켓 역인덱스. `RoomSessionRegistry`가 이것을 들고 있다.
 *
 * 소켓 역인덱스가 따로 있는 이유: 소켓이 끊길 때 "소켓만으로" 누구였는지 알아야
 * 한다. roomId를 모르는 close 콜백이 유일한 단서다.
 */
export class RoomMembers {
  // roomId → (playerId → Member)
  readonly rooms = new Map<string, Map<string, RoomMember>>()
  // socket → Member
  readonly bySocket = new Map<ClientSocket, RoomMember>()

  /**
   * 방 입장. 그 방의 첫 입장자가 host가 되고, **같은 playerId의 재입장은 자리와
   * host를 유지한 채 소켓만 교체**한다(재접속 경로).
   */
  join(roomId: string, socket: ClientSocket, playerId: string, nickname: string): RoomMember {
    let members = this.rooms.get(roomId)
    if (!members) {
      members = new Map()
      this.rooms.set(roomId, members)
    }
    const existing = members.get(playerId)
    const member: RoomMember = {
      playerId,
      roomId,
      nickname,
      host: existing ? existing.host : members.size === 0,
      status: 'online',
      socket,
    }
    members.set(playerId, member)
    if (existing?.socket) this.unlink(existing)
    this.bySocket.set(socket, member)
    return member
  }

  /** 방 안에서 이 playerId가 차지한 자리. 재접속·중복 세션 판정에 쓴다. */
  find(roomId: string, playerId: string): RoomMember | null {
    return this.rooms.get(roomId)?.get(playerId) ?? null
  }

  /**
   * 그 방의 좌석 전부(오프라인 좌석·파티 대시보드 포함).
   *
   * 방송이 아니라 **좌석마다 다른 내용을 보내야 하는** 게임이 쓴다(다빈치 코드의
   * `DavinciAudience`). 방 스냅샷의 플레이어 명단으로는 대신할 수 없다 — 대시보드는
   * 명단에 없지만 화면을 받아야 하기 때문이다.
   */
  ofRoom(roomId: string): RoomMember[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])]
  }

  ofSocket(socket: ClientSocket): RoomMember | null {
    return this.bySocket.get(socket) ?? null
  }

  /** 대기실에서의 소켓 종료·명시 퇴장. @returns 빠진 멤버(원래 없었으면 null). */
  removeBySocket(socket: ClientSocket): RoomMember | null {
    const member = this.bySocket.get(socket)
    if (!member) return null
    this.bySocket.delete(socket)
    this.detach(member)
    return member
  }

  /**
   * 게임 중 비명시 종료를 명단 이탈이 아닌 offline 전이로 기록한다.
   * 이미 새 소켓으로 교체된 뒤 옛 소켓의 close가 도착하면 현재 멤버를 건드리지 않는다.
   */
  markOffline(socket: ClientSocket): RoomMember | null {
    const member = this.bySocket.get(socket)
    if (!member) return null
    this.bySocket.delete(socket)
    const members = this.rooms.get(member.roomId)
    if (!members || members.get(member.playerId) !== member) return null
    const offline: RoomMember = { ...member, status: 'offline', socket: null }
    members.set(member.playerId, offline)
    return offline
  }

  /**
   * playerId로 좌석을 뺀다. 오프라인 멤버는 소켓이 없어 {@link removeBySocket}로 지울
   * 수 없으므로 게임 중 이탈(명시 퇴장·오프라인 자동 퇴장)은 이 경로를 쓴다.
   */
  removePlayer(roomId: string, playerId: string): RoomMember | null {
    const member = this.find(roomId, playerId)
    if (member === null) return null
    if (member.socket) this.unlink(member)
    this.detach(member)
    return member
  }

  /** 방이 비었는가 — phase·gameCode 정리 여부의 근거다. */
  isEmpty(roomId: string): boolean {
    return (this.rooms.get(roomId)?.size ?? 0) === 0
  }

  /**
   * 소켓 인덱스에서 이 멤버를 뺀다. **그 소켓이 아직 이 멤버를 가리킬 때만** 지운다 —
   * 재접속으로 교체된 뒤 도착한 옛 소켓의 close가 새 좌석을 지우면 안 된다.
   */
  private unlink(member: RoomMember): void {
    if (member.socket && this.bySocket.get(member.socket) === member) {
      this.bySocket.delete(member.socket)
    }
  }

  /** 방 명단에서 좌석을 빼고, 방이 비면 방 자체를 버린다. */
  private detach(member: RoomMember): void {
    const members = this.rooms.get(member.roomId)
    if (members === undefined) return
    members.delete(member.playerId)
    if (members.size === 0) this.rooms.delete(member.roomId)
  }
}
