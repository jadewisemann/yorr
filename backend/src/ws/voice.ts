import { z } from 'zod'
import type { RoomBroadcaster } from './broadcaster.js'
import { envelope, type OutboundEnvelope } from './envelope.js'
import type { RoomMember, RoomSessionRegistry } from './registry.js'
import { type ClientSocket, isOpen } from './socket.js'

/**
 * 음성 채팅(voice.*) 시그널링 릴레이 — backend-java `GameWebSocketHandler`의 voice 절.
 *
 * WebRTC 풀메시라 오디오는 브라우저끼리 직접 흐른다. 서버가 하는 일은 둘뿐이다
 * (docs/design/voice.md):
 *   1. 방별 음성 명단을 관리하고, 바뀔 때마다 `voice.peers`로 **방 전원**에게 전체 명단을 뿌린다
 *   2. `voice.signal`을 **내용을 열지 않고** 지목된 상대에게만 전달한다
 *
 * SDP·ICE를 파싱하지 않는 것이 계약이다 — 파싱하면 브라우저가 규격을 늘릴 때마다 서버를
 * 같이 고쳐야 한다. 그래서 `data`는 검증 없이 그대로 흘려보낸다.
 */

/**
 * `voice.signal` payload. `data`는 불투명 JSON이라 모양을 강제하지 않는다.
 * **`from`은 여기 없다** — 클라이언트가 주장하는 신분을 믿으면 남을 사칭할 수 있어
 * 서버가 레지스트리에서 꺼내 채운다.
 */
export const voiceSignalPayloadSchema = z.object({
  to: z.string().nullish(),
  data: z.unknown(),
})

export interface VoiceChannelDependencies {
  readonly registry: RoomSessionRegistry
  readonly broadcaster: RoomBroadcaster
  /** 유니캐스트(`voice.signaled`) 전송. 핸들러의 전송 경로(닫힌 소켓 스킵·실패 삼킴)를 그대로 쓴다. */
  readonly send: (socket: ClientSocket, message: OutboundEnvelope) => void
}

export class VoiceChannel {
  constructor(private readonly deps: VoiceChannelDependencies) {}

  /** `voice.join` → 명단에 넣고(멱등) `voice.peers` 브로드캐스트. */
  join(me: RoomMember): void {
    this.broadcastPeers(me.roomId, this.deps.registry.joinVoice(me.roomId, me.playerId))
  }

  /** `voice.leave` → 명단에서 빼고 `voice.peers` 브로드캐스트. **방에서 나가는 것은 아니다.** */
  leave(me: RoomMember): void {
    this.broadcastPeers(me.roomId, this.deps.registry.leaveVoice(me.roomId, me.playerId))
  }

  /**
   * `voice.signal` → 지목된 한 명에게만 `voice.signaled`로 전달한다. 방 전체로 나가지 않는
   * 유일한 메시지다 — SDP·ICE는 두 피어 사이의 협상이라 남이 받으면 의미가 없다.
   *
   * 대상 조회는 **방 스코프**라 다른 방으로는 시그널을 보낼 수 없다. 대상이 없거나 소켓이
   * 닫혀 있으면 **조용히 버린다** — 협상 중 이탈은 정상 경로이고, 오류로 만들면 누가 나갈
   * 때마다 남은 쪽에 잡음이 쌓인다.
   *
   * 명단(voiceMembers) 검증은 하지 않는다: 방 멤버면 누구에게든 릴레이된다(Java 동작 그대로).
   */
  signal(me: RoomMember, to: string, data: unknown): void {
    const target = this.deps.registry.find(me.roomId, to)
    if (!target?.socket || !isOpen(target.socket)) return
    // from은 레지스트리에서 꺼낸 값이다 — 클라이언트가 보낸 값을 쓰면 남을 사칭할 수 있다.
    this.deps.send(
      target.socket,
      envelope('voice.signaled', { from: me.playerId, data }, { roomId: me.roomId }),
    )
  }

  /**
   * 소켓이 죽거나 방을 떠날 때 음성 명단에서 뺀다. 통화 중이 아니었으면 아무 일도 없다.
   *
   * **레지스트리에서 세션을 지우기 전에** 불러야 한다(순서가 계약) — 지운 뒤에는 소켓만으로
   * 누구였는지·어느 방이었는지 알 수 없다. `voice.leave` 없이 탭을 닫는 것이 정상 경로이고,
   * 이걸 빠뜨리면 남은 사람들이 이미 없는 피어에게 계속 offer를 보낸다.
   */
  drop(socket: ClientSocket): void {
    const member = this.deps.registry.of(socket)
    if (!member) return
    if (!this.deps.registry.voiceMembersOf(member.roomId).includes(member.playerId)) return
    this.broadcastPeers(
      member.roomId,
      this.deps.registry.leaveVoice(member.roomId, member.playerId),
    )
  }

  /**
   * 명단이 바뀌었다고 방 전원에게 알린다. **통화 미참가자도 받는다** — 마이크를 켜기 전에도
   * 누가 통화 중인지 보여야 들어갈지 판단할 수 있다.
   */
  private broadcastPeers(roomId: string, peers: string[]): void {
    this.deps.broadcaster.broadcast(roomId, envelope('voice.peers', { peers }, { roomId }))
  }
}
