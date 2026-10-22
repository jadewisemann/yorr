import { delay, HttpResponse } from 'msw'
import type { MockContext, MockRestScenario, RestHandlerOptions } from './types'

export function createMockContext(options: RestHandlerOptions = {}): MockContext {
  const scenario: MockRestScenario = options.scenario ?? 'success'
  return {
    beforeResponse: async () => {
      if (scenario === 'delay') await delay(options.delayMs ?? 300)
    },
    unavailable: () =>
      scenario === 'error'
        ? HttpResponse.json(
            { code: 'MOCK_API_ERROR', message: '선택된 mock 오류입니다.' },
            { status: 503 },
          )
        : null,
    state: { nextBotNumber: 1, quickMatchPolls: 0 },
  }
}
