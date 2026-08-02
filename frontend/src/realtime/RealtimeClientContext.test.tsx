import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { FakeRealtimeClient } from './fakeRealtimeClient'
import { RealtimeClientProvider, useRealtimeClient } from './RealtimeClientContext'

describe('useRealtimeClient', () => {
  it('Provider가 준 클라이언트를 그대로 돌려준다', () => {
    const client = new FakeRealtimeClient()
    const { result } = renderHook(() => useRealtimeClient(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
      ),
    })

    expect(result.current).toBe(client)
  })

  it('Provider 밖에서는 조용히 no-op이 되지 않고 즉시 실패한다', () => {
    // 실시간 없이 렌더된 화면을 "연결된 것처럼" 보이게 두면 디버깅이 훨씬 비싸진다.
    expect(() => renderHook(() => useRealtimeClient())).toThrow('Realtime client is not available')
  })
})
