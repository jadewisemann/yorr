import { describe, expect, it } from 'vitest'
import { detectInAppBrowser } from '@/app/InAppBrowserGate'

describe('detectInAppBrowser', () => {
  it('recognizes representative embedded browsers', () => {
    expect(detectInAppBrowser('Mozilla/5.0 KAKAOTALK 11.0')).toBe(true)
    expect(detectInAppBrowser('Mozilla/5.0 Instagram 300 Android')).toBe(true)
    expect(detectInAppBrowser('Mozilla/5.0 NAVER(inapp; search; 2000)')).toBe(true)
  })

  it('does not gate regular mobile Safari', () => {
    expect(
      detectInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false)
  })
})
