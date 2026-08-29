import type { RoomSessionRegistry } from '../../ws/registry.js'
import { type ClientSocket, isOpen } from '../../ws/socket.js'
import type { DavinciAudience, DavinciOutboundEnvelope, DavinciSeat } from './davinciPorts.js'

/**
 * `DavinciAudience`의 운영 어댑터 — 레지스트리 좌석을 그대로 쓰고, 전송은 게이트웨이의
 * 전송 경로와 같은 규칙(닫힌 소켓은 건너뛰고 개별 실패는 삼킨다)을 따른다.
 *
 * 이 얇은 파일이 있는 이유는 `RoomBroadcaster`가 방 전체에 **한 프레임**을 쏘는 것만
 * 할 수 있기 때문이다. 좌석마다 payload가 다른 게임은 이 게임뿐이라, 방송기를 고치는
 * 대신 다빈치 코드 슬라이스 안에 유니캐스트 어댑터를 둔다.
 *
 * 봉투는 서비스가 이미 완성해서 넘기므로 여기서는 직렬화만 한다. `roomId`·`msgId`가
 * 없을 때 필드째 사라지는 것(NON_NULL 계약)은 `JSON.stringify`가 그대로 해 준다.
 */
export const registryAudience = (registry: RoomSessionRegistry): DavinciAudience<ClientSocket> => ({
  membersOf: (roomId: string): readonly DavinciSeat<ClientSocket>[] => registry.membersOf(roomId),
  send: (socket: ClientSocket, message: DavinciOutboundEnvelope): void => {
    if (!isOpen(socket)) return
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // 개별 소켓 실패는 무시한다(RoomBroadcaster의 소켓별 catch와 같은 이유).
    }
  },
})
