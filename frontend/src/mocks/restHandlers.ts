import { authHandlers } from './rest/authHandlers'
import { createMockContext } from './rest/context'
import { gameHandlers } from './rest/gameHandlers'
import { quickMatchHandlers } from './rest/quickMatchHandlers'
import { rankingHandlers } from './rest/rankingHandlers'
import { roomHandlers } from './rest/roomHandlers'
import type { RestHandlerOptions } from './rest/types'

export type { MockRestScenario, RestHandlerOptions } from './rest/types'

/**
 * MSW REST 목 서버. endpoint 무리마다 한 파일(`rest/*Handlers.ts`)이고, 이 함수는
 * 그것을 나열하기만 한다. 묶음 사이에 이어지는 상태(봇 번호·퀵매치 폴링)는
 * `createMockContext`가 한 벌 만들어 각 묶음에 넘긴다.
 */
export function createRestHandlers(options: RestHandlerOptions = {}) {
  const context = createMockContext(options)
  return [
    ...authHandlers(context),
    ...roomHandlers(context),
    ...gameHandlers(context),
    ...quickMatchHandlers(context),
    ...rankingHandlers(context),
  ]
}
