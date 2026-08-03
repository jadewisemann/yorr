import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InAppBrowserGate } from '@/app/InAppBrowserGate'
import { installUserAgentMock } from '@/test/harness'

/**
 * 인앱 브라우저 안내는 "링크를 밖으로 옮길 수 있는가"가 유일한 목적이다.
 * 복사 API가 없거나 막힌 인앱도 많아, 실패했을 때 주소를 직접 읽을 수 있어야 한다.
 */
describe('InAppBrowserGate', () => {
  let userAgent: ReturnType<typeof installUserAgentMock>
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  beforeEach(() => {
    userAgent = installUserAgentMock('Mozilla/5.0 KAKAOTALK 11.0')
    window.sessionStorage.clear()
  })

  afterEach(() => {
    userAgent.restore()
    vi.restoreAllMocks()
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      return
    }
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  function setClipboard(writeText: () => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  }

  it('현재 주소를 복사해 주고 복사됐다는 사실을 알린다', async () => {
    const user = userEvent.setup()
    // user-event가 setup에서 clipboard를 대체하므로 그 뒤에 우리 스텁을 얹는다.
    const writeText = vi.fn(async () => undefined)
    setClipboard(writeText)
    render(
      <InAppBrowserGate>
        <p>게임 화면</p>
      </InAppBrowserGate>,
    )

    await user.click(screen.getByRole('button', { name: '현재 링크 복사' }))

    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(await screen.findByRole('status')).toHaveTextContent('현재 링크를 복사했어요.')
  })

  it('복사가 막힌 인앱에서는 직접 복사할 수 있게 주소를 그대로 보여 준다', async () => {
    const user = userEvent.setup()
    setClipboard(() => Promise.reject(new Error('clipboard blocked')))
    render(
      <InAppBrowserGate>
        <p>게임 화면</p>
      </InAppBrowserGate>,
    )

    await user.click(screen.getByRole('button', { name: '현재 링크 복사' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('자동 복사에 실패했어요')
    expect(notice).toHaveTextContent(window.location.href)
  })

  it('세션 저장이 막힌 브라우저에서도 안내를 띄우고 그냥 진행할 수 있다', async () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage access denied')
    })
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage access denied')
    })
    const user = userEvent.setup()
    render(
      <InAppBrowserGate>
        <p>게임 화면</p>
      </InAppBrowserGate>,
    )

    expect(screen.getByRole('heading', { name: '외부 브라우저를 권장해요' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '그냥 진행' }))

    expect(screen.getByText('게임 화면')).toBeVisible()
  })

  it('이미 그냥 진행을 고른 세션에서는 안내를 다시 띄우지 않는다', () => {
    window.sessionStorage.setItem('yorr.in-app-browser-dismissed', 'true')

    render(
      <InAppBrowserGate>
        <p>게임 화면</p>
      </InAppBrowserGate>,
    )

    expect(screen.getByText('게임 화면')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '외부 브라우저를 권장해요' }),
    ).not.toBeInTheDocument()
  })
})
