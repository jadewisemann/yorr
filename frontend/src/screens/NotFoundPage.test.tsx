import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderAppHarness, resetAppTestState } from '@/test/harness'

/**
 * 알 수 없는 주소는 라우터의 notFoundComponent로 떨어진다. 라우팅 배선까지 함께 고정해야
 * "화면은 있는데 어떤 경로에서도 열리지 않는" 회귀를 잡을 수 있다.
 */
describe('NotFoundPage', () => {
  const originalPath = window.location.pathname

  afterEach(() => {
    window.history.replaceState({}, '', originalPath)
    resetAppTestState()
  })

  it('알 수 없는 주소는 어떤 주소였는지와 함께 안내하고 홈으로 돌려보낸다', async () => {
    window.history.replaceState({}, '', '/rooms/gone/results')
    const { router, user } = renderAppHarness({ initialPath: '/rooms/gone/results' })

    expect(await screen.findByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible()
    expect(screen.getByText('/rooms/gone/results')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '홈으로' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: '요트 다이스' })).toBeVisible()
  })
})
