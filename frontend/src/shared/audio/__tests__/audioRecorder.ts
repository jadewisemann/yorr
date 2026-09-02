import { afterEach, beforeEach, vi } from 'vitest'

/**
 * 진짜 `Audio` 대신 세어 볼 수 있는 요소를 만들어 두는 판.
 *
 * 사운드트랙은 모듈 수준에서 트랙을 만들어 두므로, 검사마다 모듈을 새로 불러와야
 * 이전 검사의 재생 상태가 넘어오지 않는다(`vi.resetModules`). 그 배선이 검사마다
 * 열다섯 줄씩 반복되던 것을 여기 모은다.
 */
export function installAudioRecorder() {
  const audios: HTMLAudioElement[] = []

  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    audios.length = 0
    vi.stubGlobal(
      'Audio',
      vi.fn(function AudioMock(src?: string) {
        const audio = document.createElement('audio')
        if (src) audio.setAttribute('src', src)
        audio.play = vi.fn(() => Promise.resolve())
        audio.pause = vi.fn()
        audios.push(audio)
        return audio
      }),
    )
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  /** 경로 끝으로 트랙을 찾는다 — 만들어진 순서에 기대지 않는다. */
  return (suffix: string) => audios.find((audio) => audio.getAttribute('src')?.endsWith(suffix))
}
