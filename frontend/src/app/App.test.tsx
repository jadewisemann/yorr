import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { installUserAgentMock, resetAppTestState } from '@/test/harness'
import { App } from './App'

/**
 * 앱 부팅 배선 — 게이트 → 실시간 동기화 → 라우터 순서가 지켜져야 한다.
 * 순서가 바뀌면 인앱 안내 뒤에서 화면이 먼저 뜨거나, 방이 없는데 소켓을 붙잡는다.
 */
describe('App', () => {
  afterEach(() => resetAppTestState())

  it('참여 중인 방이 없으면 홈을 띄우고 실시간 연결을 열지 않는다', async () => {
    resetAppTestState()

    render(<App />)

    expect(await screen.findByRole('heading', { name: '요트 다이스' })).toBeVisible()
    expect(useAppStore.getState().connectionStatus).toBe('idle')
  })

  it('인앱 브라우저에서는 화면보다 외부 브라우저 안내를 먼저 보여 준다', async () => {
    resetAppTestState()
    const userAgent = installUserAgentMock('Mozilla/5.0 Instagram 300 Android')

    try {
      render(<App />)

      expect(await screen.findByRole('heading', { name: '외부 브라우저를 권장해요' })).toBeVisible()
      expect(screen.queryByRole('heading', { name: '요트 다이스' })).not.toBeInTheDocument()
    } finally {
      userAgent.restore()
    }
  })
})
