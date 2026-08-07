import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider, useRealtimeClient } from '@/realtime/RealtimeClientContext'

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
    expect(() => renderHook(() => useRealtimeClient())).toThrow('Realtime client is not available')
  })
})
