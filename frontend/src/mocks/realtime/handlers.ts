import type { FakeMessageHandlers } from '@/realtime/fakeRealtimeClient'
import type { RealtimeContext } from './context'
import { roomHandlers } from './roomHandlers'
import { systemHandlers } from './systemHandlers'
import { yachtHandlers } from './yachtHandlers'

/**
 * mock 실시간 서버가 아는 클라이언트 메시지 전부. 무리별로 나눠 두되, `serverDice`·
 * `chatSequence`처럼 요청 사이에 이어지는 값은 `RealtimeContext` 하나에 모아
 * 넘긴다(각 묶음이 자기 사본을 들면 롤 결과가 어긋난다).
 */
export function createRealtimeHandlers(context: RealtimeContext): FakeMessageHandlers {
  return {
    ...systemHandlers(context),
    ...roomHandlers(context),
    ...yachtHandlers(context),
  }
}
