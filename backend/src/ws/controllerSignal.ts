import { z } from 'zod'
import { envelope, type OutboundEnvelope } from './envelope.js'
import type { RoomMember, RoomSessionRegistry } from './registry.js'
import { type ClientSocket, isOpen } from './socket.js'

/**
 * 컨트롤러 링크(`ctrl.*`) 시그널링 릴레이 — 파티 모드에서 컨트롤러 폰과 큰 화면을
 * WebRTC DataChannel로 직접 잇기 위한 SDP·ICE 교환 통로다
 * (docs/design/controller-signal.md).
 *
 * 서버가 하는 일은 하나뿐이다: `ctrl.signal`을 **내용을 열지 않고** 같은 방의 지목된
 * 상대에게만 전달한다. 삭제된 `voice.signal` 릴레이의 유니캐스트 부분과 같은 코드이고,
 * 같은 이유로 그렇다 — 파싱하는 순간 브라우저가 규격을 늘릴 때마다 서버를 같이 고쳐야 한다.
 *
 * 방송하지 않는 것이 계약이다. 협상은 두 피어 사이의 일이라 남이 받으면 의미가 없다.
 * 그래서 `chat.*`(방 전체 브로드캐스트)을 재사용할 수 없었다.
 */

/**
 * `ctrl.signal` payload. `data`는 불투명 JSON이라 모양을 강제하지 않는다.
 *
 * **`from`은 여기 없다** — 클라이언트가 주장하는 신분을 믿으면 남을 사칭할 수 있어
 * 서버가 레지스트리에서 꺼내 채운다.
 *
 * ⚠️ **`data`에 스키마 검증을 넣지 않는다.** 갈래를 아는 것은 협상하는 두 브라우저뿐이고,
 * 서버가 모양을 좁히면 링크가 조용히 죽는다(게임은 WebSocket 폴백으로 돌아서 증상이
 * 겉으로 드러나지 않는다).
 */
export const controllerSignalPayloadSchema = z.object({
  to: z.string().nullish(),
  data: z.unknown(),
})

export interface ControllerSignalDependencies {
  readonly registry: RoomSessionRegistry
  /** 유니캐스트 전송. 핸들러의 전송 경로(닫힌 소켓 스킵·실패 삼킴)를 그대로 쓴다. */
  readonly send: (socket: ClientSocket, message: OutboundEnvelope) => void
}

export class ControllerSignalChannel {
  constructor(private readonly deps: ControllerSignalDependencies) {}

  /**
   * `ctrl.signal` → 지목된 한 명에게만 `ctrl.signaled`로 전달한다.
   *
   * 대상 조회는 **방 스코프**라 다른 방으로는 시그널을 보낼 수 없다. 대상이 없거나 소켓이
   * 닫혀 있으면 **조용히 버린다** — 협상 중 이탈은 정상 경로이고, 오류로 만들면 누가 나갈
   * 때마다 남은 쪽에 잡음이 쌓인다.
   *
   * 파티 대시보드는 방 스냅샷의 플레이어 명단에 없지만 **레지스트리에는 있다**. 그래서
   * playerId만 알면 여기로 닿는다 — 링크의 협상 방향(대시보드가 먼저 건다)이 그 사실에서
   * 나온다(frontend `docs/llmwiki/controller-link.md`).
   */
  signal(me: RoomMember, to: string, data: unknown): void {
    const target = this.deps.registry.find(me.roomId, to)
    if (!target?.socket || !isOpen(target.socket)) return
    // from은 레지스트리에서 꺼낸 값이다 — 클라이언트가 보낸 값을 쓰면 남을 사칭할 수 있다.
    this.deps.send(
      target.socket,
      envelope('ctrl.signaled', { from: me.playerId, data }, { roomId: me.roomId }),
    )
  }
}
