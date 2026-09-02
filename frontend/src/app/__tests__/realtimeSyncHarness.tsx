import { render } from '@testing-library/react'
import { RealtimeSync } from '@/app/RealtimeSync'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'

/**
 * 방장으로 접속한 화면을 세우고 서버 메시지를 밀어 넣을 대역을 돌려준다.
 * `RealtimeSync`는 자식을 그대로 그리므로 자리표시 하나면 충분하다.
 */
export function mountSync() {
  const client = createRealtimeFixture({ role: 'creator' })
  render(
    <RealtimeSync client={client}>
      <div>app</div>
    </RealtimeSync>,
  )
  return client
}
