import type { FakeMessageHandlers } from '@/realtime/fakeRealtimeClient'
import { MOCK_ROOM_ID, playingRoomSnapshot, serverMessage } from '../fixtures'
import type { RealtimeContext } from './context'

/** 연결 유지(ping)·재접속·컨트롤러 링크 시그널링. */
export function systemHandlers(_context: RealtimeContext): FakeMessageHandlers {
  return {
    'sys.ping': (message) => [
      serverMessage(
        'sys.pong',
        { serverTs: message.payload.clientTs + 1 },
        { msgId: message.msgId },
      ),
    ],
    'sys.reconnect': () => [
      serverMessage('sys.reconnected', { snapshot: playingRoomSnapshot }, { roomId: MOCK_ROOM_ID }),
    ],
    /*
     * 컨트롤러 링크 시그널링은 mock에서 **아무것도 돌려주지 않는다.** 상대 브라우저가 없어서
     * 협상이 성립할 수 없고, 그러면 링크가 안 열려 연출 릴레이가 WebSocket으로 폴백한다 —
     * 그것이 mock으로 도는 화면에서 원하는 동작이다(controller-link.md 「폴백 규칙」).
     * 핸들러를 비워 두는 대신 명시적으로 등록하는 이유는 strict 모드가 던지지 않게 하려는
     * 것이고, 던지지 않아야 "상대가 없으면 조용히 버린다"는 서버 동작과 같아진다.
     */
    'ctrl.signal': () => [],
  }
}
