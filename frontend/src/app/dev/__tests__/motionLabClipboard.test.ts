import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from '@/app/dev/motionLabClipboard'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function installClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('copyTextToClipboard', () => {
  it('복사에 성공하면 true를 돌려준다', async () => {
    const writeText = vi.fn(async () => undefined)
    installClipboard(writeText)

    await expect(copyTextToClipboard('config')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('config')
  })

  it('권한이 막혀 실패하면 예외를 던지지 않고 false로 알린다', async () => {
    // 호출부는 false를 보고 텍스트영역 폴백을 띄운다 — 인앱 브라우저에서 유일한 복사 경로다.
    installClipboard(vi.fn(async () => Promise.reject(new Error('NotAllowedError'))))

    await expect(copyTextToClipboard('config')).resolves.toBe(false)
  })

  it('clipboard API가 아예 없는 브라우저에서도 false로 끝난다', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')

    await expect(copyTextToClipboard('config')).resolves.toBe(false)
  })
})
