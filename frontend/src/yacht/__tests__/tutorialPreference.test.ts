import { beforeEach, describe, expect, it } from 'vitest'
import { hideTutorial, isTutorialHidden } from '@/yacht/tutorialPreference'

describe('tutorialPreference', () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: 구현이 document.cookie를 쓰므로 테스트도 같은 표면을 조작한다
    document.cookie = 'yorr.tutorial-hidden=; max-age=0; path=/'
  })

  it('숨김을 저장하기 전에는 튜토리얼을 보여준다', () => {
    expect(isTutorialHidden()).toBe(false)
  })

  it('다시 보지 않기를 저장하면 숨김으로 읽힌다', () => {
    hideTutorial()
    expect(isTutorialHidden()).toBe(true)
  })

  it('다른 쿠키가 있어도 숨김 쿠키만 판정한다', () => {
    // biome-ignore lint/suspicious/noDocumentCookie: 구현이 document.cookie를 쓰므로 테스트도 같은 표면을 조작한다
    document.cookie = 'other=yorr.tutorial-hidden; path=/'
    expect(isTutorialHidden()).toBe(false)
  })
})
