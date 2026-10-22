export type MockRestScenario = 'success' | 'delay' | 'error'

export interface RestHandlerOptions {
  scenario?: MockRestScenario
  delayMs?: number
}

/**
 * 모든 묶음이 공유하는 시나리오 동작. `delay`는 응답 전에 기다리고, `error`는 각
 * 핸들러가 `unavailable()`로 같은 503을 돌려주게 한다 — endpoint마다 판단이 갈리지
 * 않도록 한 자리에서 만든다.
 */
export interface RestScenario {
  beforeResponse: () => Promise<void>
  unavailable: () => Response | null
}

/**
 * 핸들러 묶음이 함께 쓰는 상태. 방·봇·퀵매치가 같은 mock 방 스냅샷을 보면서
 * 요청 사이에 이어지는 값(봇 번호, 퀵매치 폴링 횟수)만 여기 둔다.
 */
export interface MockContext extends RestScenario {
  state: {
    nextBotNumber: number
    quickMatchPolls: number
  }
}
